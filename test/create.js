var assert = require("assert");
var WebSite = require('../index').WebSite;
var path = require('path');
var fs = require('fs');

var edgercFile = '~/.edgerc';
var sectionName = 'papi';
var propertyId = 'prp_284816';
var propertyName = "akamaiapibootcamp.com"; // Change this to your test property

// To run locally, set AKAMAI_TEST_HOST and AKAMAI_TEST_PROPID in your environment
// You must have a 'papi' section in your .edgerc file or use Akamai environment
// variables to set your credentials.  These credentials must be at the account
// level with read and write access in order to run these tests.
if (process.env.AKAMAI_TEST_HOST) {
    propertyName = process.env.AKAMAI_TEST_HOST;
}
if (process.env.AKAMAI_TEST_PROPID) {
    propertyId = process.env.AKAMAI_TEST_PROPID;
}
let temp_property = "travis-" + Date.now() + ".example.com"

var akamaiweb = new WebSite({path: "~/.edgerc", section: "papi"});


describe('Create a new property from clone', function () {
    it ('should clone a new property, activate, deactivate and delete', function() {
        options = {"clone":"akamaiapibootcamp.com"}
        return akamaiweb.createFromExisting(temp_property, options)
            .then(data => {
                return akamaiweb.activate(temp_property)
            })
            .then(data => {
                return akamaiweb.deactivate(temp_property)
            })
            .catch((error) =>  {
                assert(error);
            })
    })
    it('should retrieve the property rules to a file', function () {
        return akamaiweb.retrieveToFile(propertyName, 'test/new_rules.json')
            .then(data => {
                fs.readFile('test/new_rules.json','utf8', function (err, data) {
                    if (err) throw err;
                    obj = JSON.parse(data);
                    assert(obj['rules']);
                })
        })
    })
    it('should update the property from the rules', function () {
        return akamaiweb.updateFromFile(temp_property, 'test/new_rules.json')
            .then(data => {
                return akamaiweb.retrieve(propertyName)
            })
            .then(data => {
                return akamaiweb.activate(temp_property)
            })
            .then(data => {
                return akamaiweb.deactivate(temp_property)
            })
            .then(data => {
                return akamaiweb.delete(temp_property)
            })
            .catch(error => {
                assert(!error)
            })
        })
    })