'use strict';

const assert = require('assert');
const WebSite = require('../index').WebSite;
const path = require('path');
const fs = require('fs');

const edgercFile = '~/.edgerc';
const sectionName = 'papi';
let propertyId = 'prp_284816';
let propertyName = 'jenkins.base.property'; // Change this to your test property

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

const akamaiWeb = new WebSite({path: '~/.edgerc', section: 'papi'});

describe('Retrieve formats', function() {
  it('should retrieve the rules formats', function() {
    return akamaiWeb.retrieveFormats()
      .then(data => {
        return akamaiWeb.retrieveFormats(true);
      })
      .catch((error) => {
        assert(error);
      });
  });
  it('should retrieve groups', function() {
    return akamaiWeb.retrieveGroups()
      .catch((error) => {
        assert(error);
      });
  });

  it('should search for a propertyname', function() {
    return akamaiWeb.searchProperties('jenkins.base.property')
      .catch(error => {
        assert(error);
      });
  });

  it('should retrieve property hostnames', function() {
    const hostname = 'jenkins.base.property';
    return akamaiWeb.retrieve(hostname, 0, true)
      .then(data => {
        assert(data.hostnames.items > 0);
      })
      .catch(error => {
        assert(error);
      });
  });
  it('should retrieve property variables', function() {
    const hostname = 'jenkins.base.property';
    return akamaiWeb.getVariables(hostname)
      .then(() => {
        return akamaiWeb.retrieve(hostname, 1, false);
      })
      .then(data => {
        assert(data.groupId == 'grp_77649');
      });
  });
});
