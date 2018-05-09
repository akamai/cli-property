'use strict';

const assert = require('assert');
const PropertyAPI = require('../index').PropertyAPI;
const path = require('path');
const fs = require('fs');
const propertyId = 'prp_284816';
const propertyName = 'akamaiapibootcamp.com'; // Change this to your test property

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
let tempProperty = 'travis-' + Date.now() + '.example.com';

var akamaiweb = new PropertyAPI({path: '~/.edgerc', section: 'papi'});

describe('Create a new property from clone', function() {
  it('should clone a new property, activate, deactivate and delete', function() {
    const options = {'clone': propertyName};
    return akamaiweb.createFromExisting(tempProperty, options)
      .then(data => {
        return akamaiweb.activate(tempProperty);
      })
      .then(data => {
        return akamaiweb.deactivate(tempProperty);
      })
      .catch((error) => {
        assert(error);
      });
  });
  it('should retrieve the property rules to a file', function() {
    return akamaiweb.retrieveToFile(propertyId, 'test/new_rules.json')
      .then(data => {
        fs.readFile('test/new_rules.json', 'utf8', function(err, data) {
          if (err) throw err;
          const obj = JSON.parse(data);
          assert(obj['rules']);
        });
      });
  });
  it('should update the property from the rules', function() {
    return akamaiweb.updateFromFile(tempProperty, 'test/new_rules.json')
      .then(data => {
        return akamaiweb.retrieve(propertyId);
      })
      .then(data => {
        return akamaiweb.activate(tempProperty);
      })
      .then(data => {
        return akamaiweb.deactivate(tempProperty);
      })
      .then(data => {
        return akamaiweb.delete(tempProperty);
      })
      .catch(error => {
        assert(!error);
      });
  });
});
