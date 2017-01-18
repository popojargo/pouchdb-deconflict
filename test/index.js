/* global expect */

var chai = require('chai'),
		should = chai.should(),
		expect = chai.expect,
		PouchDB = require("pouchdb"),
		pouchdb_deconflict = require('../index'),
		blindResolution = pouchdb_deconflict.blindResolution;

var db1 = new PouchDB("db1");
var db2 = new PouchDB("db2");


beforeEach(function () {
	db1 = new PouchDB("db1");
	db2 = new PouchDB("db2");
	return db1;
});
/**
 * Cleaning of the databases after each tests.
 * @returns {Promise}	Returns a promise
 */
afterEach(function () {
	return db1.destroy().then(function (result) {
		return db2.destroy();
	});

});



/**
 * Function that generate a  conflict in the database 1
 * @param {PouchDB} db1	A PouchDB instance that will contains the conflicts
 * @param {PouchDB} db2	A PouchDB instance that will be used to create the conflict.
 * @returns {Object}	Returns a PouchDB promise.
 */
function generateConflicts(db1, db2) {
	//Create a document
	return db1.put({_id: "foo", count: 1}).then(function (result) {
		//Replicate the document
		return db1.replicate.to(db2);
	}).then(function (result) {
		//Get the latest revision
		return db1.get("foo");
	}).then(function (doc) {
		//We update the document to a certain revision
		doc.count = 3;
		return db1.put(doc);
	}).then(function (result) {
		//We get the latest revision on the second database
		return db2.get("foo");
	}).then(function (doc) {
		doc.count = 4;
		return db2.put(doc);
	}).then(function (result) {
		//Replicate to create conflicts
		db1.replicate.from(db2);
	}).catch(function (err) {
		console.log(err);
	});
}

describe("Conflict generation", function () {
	it("Should returns a promise", function () {
		generateConflicts(db1, db2).then(function (result) {
			expect(result).to.not.be.null;
		}).catch(function (err) {
			expect(err).to.not.be.null;
		});
	});

	it("Should contains conflicts", function () {
		var emitConflicts = function (doc) {
			if (doc._conflicts)
				emit(doc._conflicts);
		};
		db1.query(emitConflicts).then(function (result) {
			expect(result.rows.length).to.be.above(0);
		}).catch(function (err) {

		});

	});



});



describe("BlindResolution", function () {


	it('Returns a successful response since there is no documents.', function () {
		var db1 = new PouchDB("test");
		blindResolution(db1, null, function (result) {
			result.Success.should.equal(true);
		});
	});

	//Parameter validation
	it("Should throw a TypeError", function () {
		expect(blindResolution.bind(blindResolution, null)).to.throw(TypeError);
	});

	it("Should call the callback function", function () {
		blindResolution(db1, function (result) {
			result.should.eventually.be.not.null;
		});
	});




});

