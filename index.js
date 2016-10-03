var Args = require("vargs").Constructor;
var PouchDB = require("pouchdb");


var Texts = {
	operationFail: "The current operation failed.",
	success: "The function successfully create the documents",
	notConflicts: "Document is not conflicted."
};

/* Utils functions */


/**
 * This function takes the list of revisions and removes any deleted or not 'ok' ones.
 * @param {Array} list An array of documents retrieved from the database.
 * @param {String} excludedRev The revision excluded from the filter.
 * @return {Array} Returns a flat array of document objects
 */
function filterList(list, excludedRev) {
	var retval = [];
	for (var i in list)
		if (list[i].ok && !list[i].ok._deleted &&
				(!excludedRev || list[i].ok._rev !== excludedRev))
			retval.push(list[i].ok);
	return retval;
}

/**
 * Convert the incoming array of document to an array of deletions - {_id:"x",_rev:"y",_deleted:true}
 * @param {Array} list An array of documents(objects)
 * @return {Array} An array with all the documents marked as  _deleted.
 */
function convertToDeletions(list) {
	var retval = [];
	for (var i in list)
		retval.push({_id: list[i]._id, _rev: list[i]._rev, _deleted: true});
	return retval;
}

/**
 * Copy the contents of object b into object a
 * @param {Object} a	The source object
 * @param {Object} b	The object to merge.
 * @returns {Object}	Returns the new object.
 */
function objmerge(a, b) {
	for (var n in b)
		if (b.hasOwnProperty(n)) {
			if (n !== "_id" && n !== "_rev") {
				a[n] = b[n];
			}
		}
	return a;
}

/**
 * Determine if the couchDb docs are equals or not.
 * @param {Object} a	The first object to compare
 * @param {Object} b	The second object to compare.
 * @returns {Boolean}	True if they are equal. Otherwise false.
 */
function docsAreEqual(a, b) {
	a = normalizeDoc(copyObject(a));
	b = normalizeDoc(copyObject(b));
	if (Object.keys(a).length !== Object.keys(b).length)
		return false;
	for (var n in a) {
		if (a.hasOwnProperty(n) && b[n] !== a[n])
			return false;
	}

	return true;
}

/**
 * Normalize a document by removing its _rev.
 * @param {Object} doc	A document object.
 * @returns {Object}	The normalized document.
 */
function normalizeDoc(doc) {
	if (doc._rev)
		delete doc._rev;
}

/**
 * Convert an object to an array. It simply remove the key on the first level to remove index.
 * @param {Object} obj	The object to convert.
 * @returns {Array}	Returns an array with the object values.
 */
function objToArray(obj) {
	var arr = [];
	for (var n in obj)
		if (obj.hasOwnProperty(n))
			arr.push(obj);
	return arr;
}

/**
 * Deep copy of an object
 * @param {Object} obj	The object to copy.
 * @returns {Object}	The object copy.
 */
function copyObject(obj) {
	var newObj = {};
	for (var n in obj)
		if (obj.hasOwnProperty(obj)) {
			if (typeof obj[n] === "object" && !Array.isArray(obj[n]))
				newObj[n] = copyObject(obj[n]);
			else
				newObj[n] = obj[n];
		}
	return newObj;
}

/* Public methods */

/**
 * Resolve the document by taking the document with the "time" field the most recent.
 * @param {PouchDB} db	The PouchDB object.
 * @param {String} docid	The id of the document to resolve.
 * @param {String} fieldname	The field that keeps the lastest timestamp.
 * @param {function} callback	The callback function to call.	
 */
function latestWins(db, docid, fieldname, callback) {
	//Get all the revisions
	db.get(docid, {open_revs: 'all'}).then(function (result) {
		// Remove the deleted Revisions
		var doclist = filterList(result);

		//Only one revision, no losers.
		if (doclist.length <= 1)
			return callback({Success: true, Msg: Texts.noConflicts});


		//Ascending sort by the time field
		doclist.sort(function (a, b) {
			return a[fieldname] - b[fieldname];
		});

		//Don't delete the winner
		doclist.pop();

		//Mark as deleted the loosers.
		doclist = convertToDeletions(doclist);
		return db.bulk({docs: doclist});
	}).then(function (result) {
		return callback({Success: true, Msg: Texts.success, Value: result});
	}).catch(function (err) {
		console.warn(err);
		return callback({Success: false, Msg: Texts.operationFail});
	});
}

/**
 * Fetch a document and merge all the conflicted revision into the current revision.
 * @param {PouchDB} db	The PouchDB object of the database.
 * @param {String} docid	The document id.
 * @param {Function} callback	A callback function to be called after the merge is over.
 */
function merge(db, docid, callback) {
	//Get the winning revision
	db.get(docid, {conflicts: true}).then(function (doc) {
		var revs = [];
		if (doc._conflicts)
			revs = doc._conflicts;
		_mergeRevs(db, doc, revs, callback);
	}).catch(function (err) {
		console.warn(err);
		return callback({Success: false, Msg: Texts.operationFail});
	});
}

/**
 * Merge the conflicted revisions into the specified document.
 * @private
 * @param {PouchDB} db	The pouchDB object.
 * @param {Object} doc	The winning document.
 * @param {Array} conflictRevs	An array of conflicted revisions.
 * @param {Function} callback	The callback function that will be called after the merge is complete.
 */
function _mergeRevs(db, doc, conflictRevs, callback) { 	//Parameter validation
	if (!conflictRevs || typeof conflictRevs === "function" || (Array.isArray(conflictRevs) && conflictRevs.length === 0))
		return callback({Success: true, Msg: Texts.success});

	//Fetch the document revision documents.
	db.get(doc._id, {include_docs: true, open_revs: [conflictRevs]}).then(function (result) {
		var losingLeafs = [];
		//Remove the _deleted leafs.
		var losingLeafs = filterList(result, doc._rev);

		//No conflicts
		if (losingLeafs.length < 1) {
			return callback({Success: true, Msg: Texts.noConflicts});
		}

		//We merge the losing revision into the winning revision.
		for (var i in losingLeafs) {
			var loser = losingLeafs[i];
			doc = objmerge(doc, loser);
		}

		//We mark as _deleted the losing leafs.
		var docList = convertToDeletions(losingLeafs);

		//We update the winning document
		docList.push(doc);
		// now we can deleted the unwanted revisions and create a new winner
		return db.bulk({docs: docList});

	}).then(function (result) {
		return callback({Success: true, Msg: Texts.success, Value: result});
	}).catch(function (err) {
		console.warn(err);
		return callback({Success: false, Msg: Texts.operationFail});
	});

}

/**
 * Resolve a conflict by knowing the nomiated revision
 * @param {PouchDB} db	The Pouchdb object of the database.
 * @param {String} docid	The document id to resolve.
 * @param {String} rev	The winning revision of this document.
 * @param {Function} callback
 */
function nominated(db, docid, rev, callback) {
	//Fetch all the revisions
	db.get(docid, {open_revs: 'all'}).then(function (result) {
		//Remove the _deleted leafs 
		var doclist = filterList(result, rev);

		//No conflicts
		if (doclist.length < 1)
			return callback({Success: true, Msg: Texts.success});

		//Mark as _deleted
		doclist = convertToDeletions(doclist);
		return db.bulk({docs: doclist});
	}).then(function (result) {
		callback({Success: true, Msg: Texts.success});
	}).catch(function (err) {
		console.warn(err);
		callback({Success: false, Msg: Texts.operationFail});
	});
}

/**
 * Resolve the conflicts by deleting the loosing revision. This can be executed 
 * on the whole database, on on certains docs.
 * @param {nanoDB} db	The database object.
 * @param {Array|String|Null} docid [null] Determine the id/ids to be resoluted.
 *  If null, it will be applied to the whole database.
 * If it's null, it will be applied to every documents.
 * @param {Function} callback [null] The callback function executed after the resolution.
 */
function blindResolution() { 		//Parameter binding
	var args = new (Args)(arguments);
	var db = args.first;
	var callback = args.callback;
	var ids = args.last;
	//Parameter validation
	if (typeof ids === "boolean")
		ids = null;
	//We convert to an array if it has 1 or more values.
	if (ids != null && !Array.isArray(ids))
		ids = [ids];
	//We need to create the design documents to get all the conflicts
	if (ids === null) {
		var designDoc = {_id: "_design/resolver",
			views: {getConflicts: {map: function (doc) {
						if (doc._conflicts)
							emit(doc._conflicts);
					}
				}.toString()
			}
		};
		createDocuments(db, [designDoc], function (result) {
			if (!result.Success)
				callback({Success: false, Msg: Texts.operationFail});
			else {
				db.query("resolver").then(function (result) { 				//If we have conflicts, we resolve them
					if (result && result.rows && result.rows.length > 0) {
						var docsToDelete = [];
						for (var i = 0; i < result.rows.length; i++) {
							var row = result.rows[i];
							if (!row.error && row.key.length > 0)
								for (var j = 0; j < row.key.length; j++)
									docsToDelete.push({_id: row.id, _rev: row.key[j]});
						}
						return db.bulkDocs(docsToDelete);
					} else {
						callback({Success: true, Msg: Texts.operationFail});
					}
				}).then(function (result) {
					callback({Success: true, Msg: Texts.success, Value: result});
				}).catch(function (err) {
					console.log(JSON.stringify(err));
					callback({Success: false, Msg: Texts.operationFail});
				});
			}
		});
	}
}

/**
 * Creates the documents or updates them if they are already existing.
 * @param {PouchDB} db	The PouchDB object of the database.
 * @param {Array} docs	An array of documents to create or update.	
 * @param {Function} callback	The callback function that will be called with an information message as the first parameter.
 */
function createDocuments(db, docs, callback) {
	if (callback === undefined || typeof callback !== "function")
		callback = function () {};
	if (!Array.isArray(docs))
		docs = [docs];
	var docNames = [];
	var indexedDocs = {};
	//We get the names from the doc array of object.
	for (var n in docs)
		if (docs[n]) {
			docNames.push(docs[n]._id);
			indexedDocs[docs[n]._id] = docs[n];
		}

	//We get the docs
	db.allDocs({keys: docNames, include_docs: true}).then(function (result) {
		var hasErrors = false;
		for (var i = 0; i < result.rows.length; i++) {
			var row = result.rows[i];
			if (row.error && row.error.toLowerCase() !== "not_found") {
				console.warn("Error with the document " + row.key);
				hasErrors = true;
				break;
			} else if (docsAreEqual(row.doc, indexedDocs[row.id]))
				delete indexedDocs[row.id];
			else
				indexedDocs[row.id]._rev = row.value.rev;
		}
		if (!hasErrors)
			return db.bulkDocs(objToArray(indexedDocs));
		else
			callback({Success: false, Msg: Texts.operationFail});
	}).then(function (result) {
		callback({Success: true, Msg: Texts.success});
	}).catch(function (err) {
		console.warn(err);
		callback({Success: false, Msg: Texts.operationFail});
	});
}

module.exports = {
	blindResolution: blindResolution,
	nominated: nominated,
	latestWins: latestWins
};