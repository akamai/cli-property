'use strict';

const assert = require('assert');
const ApropertyAPI = require('../index').ApropertyAPI;

const edgercFile = '~/.edgerc';
const sectionName = 'papi';
const groupId = 'grp_77649';
const contractId = 'ctr_C-1FRYVV3';
const cpcode = '384473';
const edgeHostnameId = 'ehn_1596213';

let propertyId = 'prp_290361';
let propertyName = 'bootcamp.akamaiapibootcamp.com'; // Change this to your test property

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

const akamaiweb = new ApropertyAPI({path: edgercFile, section: sectionName});

describe('Check read functions', function() {
  it('should return a property', function() {
    return akamaiweb._getProperty('bc.akamaiapibootcamp.com')
      .then(property => {
        assert(property.propertyId);
      });
  });
  it('should return the right configuration', function() {
    akamaiweb.srcProperty = 'bootcamp.akamaiapibootcamp.com';
    return akamaiweb._getCloneConfig(akamaiweb.srcProperty)
      .then(cloneConfig => {
        assert.equal(akamaiweb.srcProperty, cloneConfig.rules.propertyName);
      });
  });
  it('should return the group list', function() {
    return akamaiweb._getGroupList()
      .then(groupList => {
        assert.equal(groupList.accountId, 'act_B-C-1FRYVMN');
      });
  });
  it('should return the hostname list, STAGING', function() {
    return akamaiweb._getHostnameList(propertyName, 0)
      .then(hostnameList => {
        assert(hostnameList.hostnames.items);
      });
  });
  it('should get a list of properties with our propertyName', function() {
    return akamaiweb._getPropertyList(contractId, groupId)
      .then(list => {
        let propExists = false;
        return list.properties.items.map(item => {
          if (item.propertyName == propertyName)
            propExists = true;
        });
        assert(propExists);
      });
  });
  it('should retrieve the property rules for our property', function() {
    return akamaiweb._getPropertyRules(propertyId)
      .then(propertyRules => {
        assert(propertyRules['accountId']);
      });
  });
});
