'use strict';
const assert = require('assert');
const ApropertyAPI = require('../index').ApropertyAPI;

const timeInMs = Date.now();
let propertyName = 'jenkins.base.property'; // Change this to your test property

// To run locally, set AKAMAI_TEST_HOST in your environment
// You must have a 'papi' section in your .edgerc file or use Akamai environment
// variables to set your credentials.  These credentials must be at the account
// level with read and write access in order to run these tests.
if (process.env.AKAMAI_TEST_HOST) {
  propertyName = process.env.AKAMAI_TEST_HOST;
}

const akamaiweb = new ApropertyAPI({path: '~/.edgerc', section: 'papi'});

describe('Modify property', function() {
  it('should fail to modify an activated property', function() {
    let options = {'version': 6,
      'origin': 'test.origin.com'};
    return akamaiweb.setOrigin(propertyName, options.version, options.origin, options.forward)
      .catch(error => {
        console.log(error);
        assert(JSON.parse(error)['title'] == 'Property version already activated');
      });
  });
  it('should create a new property version', function() {
    return akamaiweb.createNewPropertyVersion(propertyName)
      .then(() => {
        assert(true);
      });
  });
  it('should modify origin', function() {
    let options = {'origin': 'fancynew.origin.com'};
    return akamaiweb.setOrigin(propertyName, 0, options.origin, null)
      .then(() => {
        return akamaiweb.retrieve(propertyName);
      })
      .then(rules => {
        rules.rules.behaviors.map(behavior => {
          if (behavior.name == 'origin') {
            assert(behavior.options.hostname == options.origin);
          }
        });
      })
      .catch((error) => {
        assert(error);
      });
  });

  it('should add and delete hosts', function() {
    let host = 'fancynew.akamaiapibootcamp.com';
    return akamaiweb.addHostnames(propertyName, 0, host)
      .then(() => {
        return akamaiweb.retrieve(propertyName, 0, true);
      })
      .then(rules => {
        let hostnames = rules.hostnames.items;
        let contained = 0;
        hostnames.map(entry => {
          if (entry.cnameFrom == host) contained = 1;
        });
        assert(contained == 1);
        return akamaiweb.delHostnames(propertyName, 0, host);
      })
      .then(() => {
        return akamaiweb.retrieve(propertyName, 0, true);
      })
      .then(rules => {
        let hostnames = rules.hostnames.items;
        let contained = 0;
        hostnames.map(entry => {
          if (entry.cnameFrom == host) {
            console.log(entry);
            contained = 1;
          }
        });
        assert(contained == 0);
      })
      .catch((error) => {
        console.log(error);
      });
  });

  it('should set SureRoute Host', function() {
    let sureRouteUrl = `/${timeInMs}.html`;
    return akamaiweb.setSureRoute(propertyName,
      0,
      null,
      sureRouteUrl,
      null)
      .then(() => {
        return akamaiweb.retrieve(propertyName)
          .then(rules => {
            rules.rules.behaviors.map(behavior => {
              if (behavior.name == 'sureRoute') {
                assert(behavior.options.sr_test_object_url == sureRouteUrl);
              }
            });
          });
      });
  });
});
