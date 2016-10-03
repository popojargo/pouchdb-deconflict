var should = require('chai').should(),
PouchDB = require("pouchdb"),
    pouchdb_deconflict = require('../index'),
    blindResolution =  pouchdb_deconflict.blindResolution;


describe('#blindResolution', function() {


  it('Returns a successful response since there is not documents.', function() {
    var db = new PouchDB("test");
    blindResolution(db,null,function(result){
      result.Success.should.equal(true);
    });
  });


});

