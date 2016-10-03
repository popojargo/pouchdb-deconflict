var Args = require("vargs").Constructor;
var PouchDB = require("pouchdb");


/**
 * Resolve the conflicts by deleting the loosing revision. This can be executed 
 * on the whole database, on on certains docs.
 * @param {nanoDB} db	The database object.
 * @param {Array|String|Null} docid [null] Determine the id/ids to be resoluted.
 *  If null, it will be applied to the whole database.
 * If it's null, it will be applied to every documents.
 * @param {Function} callback [null] The callback function executed after the resolution.
 */
function blindResolution() {
	//Parameter binding
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
		var designDoc = {
			_id: "_design/resolver",
			views: {
				getConflicts: {
					map: function (doc) {
						if (doc._conflicts)
							emit(doc._conflicts);
					}
				}.toString()
			}
		};
		createDocuments(db, [designDoc], function (result) {
			if (!result.Success)
				callback(result);
			else {
				return db.query("resolver");
			}
		}).then(function (result) {
			//If we have conflicts, we resolve them
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
				callback({Success: true});
			}
		}).then(function (result) {
			callback({Success: true, Value: result});
		}).catch(function (err) {
			console.warn("An error occured.");
			console.log(JSON.stringify(err));
			callback({Success: false, Error: err});
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

	var texts = {
		operationFail: "The current operation failed.",
		success: "The function successfully create the documents"
	};

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
			callback({Success: false, Text: texts.operationFail});
	}).then(function (result) {
		callback({Success: true, Text: texts.success});
	}).catch(function (err) {
		console.warn(JSON.stringify(err));
		callback({Success: false, Text: texts.operationFail});
	});
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

module.exports = {
	blind: blindResolution
};