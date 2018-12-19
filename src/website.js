// Copyright 2017 Akamai Technologies, Inc. All Rights Reserved
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//   http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
'use strict';

let EdgeGrid = require('edgegrid');
let untildify = require('untildify');
let md5 = require('md5');
let fs = require('fs');
let tmpDir = require('os').tmpdir();

let concurrent_requests = 0;
const REQUEST_THROTTLE = process.env.REQUEST_THROTTLE ? process.env.REQUEST_THROTTLE : 10;
let cache_complete = 0;

//export
const LATEST_VERSION = {
    STAGING: -2,
    PRODUCTION: -1,
    LATEST: 0
};

//export
const AKAMAI_ENV = {
    STAGING: 'STAGING',
    PRODUCTION: 'PRODUCTION'
};

function sleep(time) {
    return new Promise((resolve) => setTimeout(resolve, time));
}

/**
 * WebSite configuration and manipulation. Use this class to control the workflow of your Akamai configuration for which
 * you normally would use the Property Manager apis.
 * @author Colin Bendell
 */

//export default class WebSite {
class WebSite {

    /**
     * Default constructor. By default the `~/.edgerc` file is used for authentication, using the `[default]` section.
     * @param auth {Object} providing the `path`, and `section` for the authentication. Alternatively, you can pass in
     *     `clientToken`, `clientSecret`, `accessToken`, and `host` directly.
     */
    constructor(auth = { path: "~/.edgerc", section: "default", debug: false, default: true}) {

        if (auth.clientToken && auth.clientSecret && auth.accessToken && auth.host)
            this._edge = new EdgeGrid(auth.clientToken, auth.clientSecret, auth.accessToken, auth.host, auth.debug);
        else
            this._edge = new EdgeGrid({
                path: untildify(auth.path),
                section: auth.section,
                debug: auth.debug
            });
        this._propertyById = {};
        this._propertyByName = {};
        this._propertyByHost = {};
        this._initComplete = false;
        this._ehnByHostname = {};
        this._propertyHostnameList = {};
        this._edgeHostnames = [];
        this._newestRulesFormat = "";
        if (auth.create) {
            this._initComplete = true;
        }
    }

    _init() {
        if (this._initComplete)
            return Promise.resolve();
        if (Object.keys(this._propertyById).length > 0) {
            this._initComplete = true;
            return Promise.resolve();
        }
        return this.retrieveFormats(true)
            .then(format => {
                this._newestRulesFormat = format;
                return Promise.resolve();
            })
    };

    _initPropertyCache(propertyLookup) {
        let groupcontractList = [];
        let foundProperty = "";
        console.error('Init PropertyManager cache (hostnames and property list)');

        return this._getGroupList()
            .then(data => {
                return new Promise((resolve, reject) => {
                    return resolve(data);
                })
            })
            .then(data => {
                if (data.groups && data.groups.items)
                    data.groups.items.map(item => {
                        if (item.contractIds)
                            item.contractIds.map(contractId => {
                                // if we have filtered out the contract and group already through the constructor, limit the list appropriately
                                //TODO: clean this logic
                                if ((!this._groupId || this._groupId === item.groupId) && (!this._contractId || this._contractId === contractId))
                                    groupcontractList.push({
                                        contractId: contractId,
                                        groupId: item.groupId
                                    });
                            });
                    });
                // get the  list of all properties for the known list of contracts and groups now
                console.error('... retrieving properties from %s groups', groupcontractList.length);
                return Promise.all(groupcontractList.map(v => {
                    return this._getPropertyList(v.contractId, v.groupId);
                }));
            })
            .then(propList => {
                let promiseList = [];
                
                propList.map(v => {
                    if (!v || !v.properties || !v.properties.items) return;
                    return v.properties.items.map(item => {
                        let configName = item.propertyName;
                        configName = configName.replace(/[^\w.-]/gi, '_')
                        item.propertyName = configName;
                        //TODO: should use toJSON() instead of the primitive toString()
                        item.toString = function () {
                            return this.propertyName;
                        };
                        this._propertyByName[item.propertyName] = item;
                        this._propertyById[item.propertyId] = item;
                        if (item.propertyName == propertyLookup) {
                            foundProperty = item;
                            promiseList = []
                        }
                    });
                });
                cache_complete = 1;
            })
    }

    _getNewProperty(propertyId, groupId, contractId) {
        return new Promise((resolve, reject) => {

            let request = {
                method: 'GET',
                path: `/papi/v1/properties/${propertyId}?contractId=${contractId}&groupId=${groupId}`,
            };
            this._edge.auth(request);

            this._edge.send(function (data, response) {
                if (response && response.statusCode >= 200 && response.statusCode < 400) {
                    let parsed = JSON.parse(response.body);
                    resolve(parsed);
                } else if (response && response.statusCode == 403) {
                    console.error('... your client credentials have no access to this group, skipping {%s : %s}', contractId, groupId);
                    resolve(null);
                } else {
                    reject(response);
                }
            });
        });
    }

    _getCloneConfig(srcProperty, srcVersion = LATEST_VERSION.LATEST) {
        let cloneFrom = {};
        let contractId,
            groupId,
            productId,
            edgeHostnameId, 
            hosts;

        return this._getProperty(srcProperty, srcVersion)
            .then(cloneFromProperty => {
                contractId = cloneFromProperty.contractId;
                groupId = cloneFromProperty.groupId;

                let productionHosts = cloneFromProperty.productionHosts;
                let stagingHosts = cloneFromProperty.stagingHosts;
                let latestHosts = cloneFromProperty.latestHosts;

                let hosts = productionHosts || stagingHosts || latestHosts;
                if (hosts) {
                    edgeHostnameId = hosts[0]["edgeHostnameId"];
                    if (!edgeHostnameId) {
                        edgeHostnameId = hosts[0]["cnameTo"];
                    }
                }

                cloneFrom = {
                    propertyId: cloneFromProperty.propertyId,
                    groupId: groupId,
                    contractId: contractId,
                    edgeHostnameId: edgeHostnameId
                };
                
                return WebSite._getLatestVersion(cloneFromProperty, srcVersion)
            })
            .then(version => {
                if (!version) {
                    return Promise.reject("Unable to find requested version")
                }
                cloneFrom.version = version;
                return new Promise((resolve, reject) => {
                    console.error('... retrieving clone info');

                    let request = {
                        method: 'GET',
                        path: `/papi/v1/properties/${cloneFrom.propertyId}/versions/${cloneFrom.version}?contractId=${contractId}&groupId=${groupId}`,
                        followRedirect: false
                    };
                    this._edge.auth(request);

                    this._edge.send(function (data, response) {
                        if (response && response.statusCode >= 200 && response.statusCode < 400) {
                            let parsed = JSON.parse(response.body);
                            cloneFrom.cloneFromVersionEtag = parsed.versions.items[0]["etag"];
                            cloneFrom.productId = parsed.versions.items[0]["productId"];
                            cloneFrom.ruleFormat = parsed.versions.items[0]["ruleFormat"]
                            resolve(cloneFrom);
                        } else {
                            reject(response);
                        }
                    });
                })
            })
            .then(cloneFrom => {
                console.error('... retrieving clone rules for cpcode')
                return new Promise((resolve, reject) => {
                    let request = {
                        method: 'GET',
                        path: `/papi/v1/properties/${cloneFrom.propertyId}/versions/${cloneFrom.version}/rules?contractId=${contractId}&groupId=${groupId}`,
                        followRedirect: false
                    };
                    this._edge.auth(request);

                    this._edge.send(function (data, response) {
                        if (response && response.statusCode >= 200 && response.statusCode < 400) {
                            let parsed = JSON.parse(response.body);
                            cloneFrom.rules = parsed;
                            resolve(cloneFrom);
                        } else {
                            reject(response);
                        }
                    });
                })
            })
            .then(cloneFrom => {
                cloneFrom.rules.rules.behaviors.map(behavior => {
                    if (behavior.name == "cpCode") {
                        cloneFrom.cpcode = behavior.options.value.id
                    }
                })
                return Promise.resolve(cloneFrom);
            })
    };

    _getGroupList(fallThrough = false) {
        return new Promise((resolve, reject) => {
            console.error('... retrieving list of Group Ids');

            let request = {
                method: 'GET',
                path: '/papi/v1/groups',
                followRedirect: false,
                followAllRedirects: false
            };
            this._edge.auth(request);

            this._edge.send(function (data, response) {
                if (!response && fallThrough) {
                    console.error("... No response from server for groups")
                    reject();
                } else if (!response) {
                    return this._getGroupList(1)
                } else if (response && response.statusCode >= 200 && response.statusCode < 400) {
                    let parsed = JSON.parse(response.body);
                    resolve(parsed);
                } else {
                    reject(response);
                }
            });
        });
    };

    //TODO: this will only be called for LATEST, CURRENT_PROD and CURRENT_STAGE. How do we handle collecting hostnames of different versions?
    _getHostnameList(propertyId, versionLookup=0, newConfig = false, edgeHostnameId=null) {
        let property;
        if (newConfig) {
            return Promise.resolve();
        }

        return this._getProperty(propertyId)
            .then(property => {
                let version = WebSite._getLatestVersion(property, versionLookup)
                
                //set basic data like contract & group
                const contractId = property.contractId;
                const groupId = property.groupId;
                const propertyId = property.propertyId;

                return new Promise((resolve, reject) => {
                    console.error('... retrieving list of hostnames {%s : %s : %s}', contractId, groupId, propertyId);
                    if (this._propertyHostnameList &&
                        this._propertyHostnameList[propertyId] &&
                        this._propertyHostnameList[propertyId][version]) {
                        resolve(this._propertyHostnameList[propertyId][version]);
                    } else {
                        let request = {
                            method: 'GET',
                            path: `/papi/v1/properties/${propertyId}/versions/${version}/hostnames/?contractId=${contractId}&groupId=${groupId}`,
                            followRedirect: false
                        };
                        this._edge.auth(request);

                        this._edge.send((data, response) => {
                            if ((response == false) || (response == undefined)) {
                                console.error("... No response from server for " + propertyId + ", skipping")
                                resolve(propertyId);
                            }
                            if (response && response.body && response.statusCode >= 200 && response.statusCode < 400) {
                                let parsed = JSON.parse(response.body);
                                resolve(parsed);
                            } else if (response && (response.statusCode == 500 || response.statusCode == 400)) {
                                // Work around PAPI bug
                                console.error("... Error from server for " + propertyId + ", skipping")
                                resolve(propertyId)
                            } else if (response && response.statusCode == 403) {
                                console.error("... No permissions for property " + propertyId)
                                resolve(propertyId)
                            } else {
                                reject(response);
                            }
                        })
                    }
                });
            });
    };

    _getMainProduct(groupId, contractId, productId) {
        let productInfo;
        return new Promise((resolve, reject) => {
            console.error('... retrieving list of Products for this contract');
            let request = {
                method: 'GET',
                path: `/papi/v1/products?contractId=${contractId}&groupId=${groupId}`,
                followRedirect: false,
                followAllRedirects: false
            };
            this._edge.auth(request);

            this._edge.send(function (data, response) {
                if (response && response.statusCode >= 200 && response.statusCode < 400) {
                    let parsed = JSON.parse(response.body);
                                        
                    productId ?
                    parsed.products.items.map( item => {
                        if( productId === item.productId) {
                            productInfo = {
                                groupId: groupId,
                                contractId: contractId,
                                productId: productId,
                                productName: item.productId.substring(4)
                            }
                        }
                    })
                    : parsed.products.items.map(item => {
                        if( ["prd_SPM",
                            "prd_Dynamic_Site_Del",
                            "prd_Alta",
                            "prd_Rich_Media_Accel",
                            "prd_Download_Delivery",
                            "prd_IoT",
                            "prd_Site_Del",
                            "prd_Site_Accel",
            			    "prd_Fresca"
                        ].indexOf(item.productId)>= 0) {
                            if (productInfo == null) {
                                productInfo = {
                                    groupId: groupId,
                                    contractId: contractId,
                                    productId:item.productId,
                                    productName:item.productId.substring(4)
                                }
                            }
                        }
                    });
                    if(productInfo){
                        resolve(productInfo);
                    }else{
                        reject(`Unable to find the Product '${ productId }' in this group/contract.`);
                    }
                } else if (response.statusCode == 403) {
                    console.error('... your credentials do not have permission for this group, skipping  {%s : %s}', contractId, groupId);
                    resolve(null);
                } else {
                    console.error("Unable to find a delivery product in this group/contract.  Please open an issue if you wish to add one.")
                    reject(response);
                }
                resolve(productInfo);
            });
        });
    };

    _searchByValue(queryObj) {
            return new Promise((resolve, reject) => {
            console.error('... searching ' + Object.keys(queryObj) + ' for ' + queryObj[Object.keys(queryObj)[0]]);

            let request = {
                method: 'POST',
                path: `/papi/v1/search/find-by-value`,
                body: queryObj
            };

            this._edge.auth(request);
            this._edge.send(function (data, response) {
                if (response && response.statusCode >= 200 && response.statusCode < 400) {
                    let parsed = JSON.parse(response.body);
                    resolve(parsed);
                } else {
                    reject(response);
                }
            })
        })
    }

    _listProperties(groupId, contractId){
        return new Promise((resolve, reject) => {
            if(!groupId && !contractId){
                reject("Please specify a Group and a Contract");
            }else if(!groupId){
                reject("Please specify a Group")
            }else if(!contractId){
                reject("Please specify a Contract")
            }
            console.error('... retrieving list of Properties for this group and contract');
            let request = {
                method: 'GET',
                path: `/papi/v1/properties?contractId=${contractId}&groupId=${groupId}`
            }
            this._edge.auth(request);
            this._edge.send(function(data, response) {
                if (response && response.statusCode >= 200 && response.statusCode < 400) {
                    let parsed = JSON.parse(response.body);
                    resolve(parsed);
                } else {
                    reject(response);
                }
            })
        })
    }

    _getPropertyMetadata(propertyId, groupId, contractId) {
         return new Promise((resolve, reject) => {
            console.error('... getting info for ' + propertyId);

            let request = {
                method: 'GET',
                path: `/papi/v1/properties/${propertyId}?contractId=${contractId}&groupId=${groupId}`,
            };
            this._edge.auth(request);
            this._edge.send(function (data, response) {
                if (response && response.statusCode >= 200 && response.statusCode < 400) {
                    let parsed = JSON.parse(response.body);
                    resolve(parsed.properties.items[0]);
                }
            })
        })
    }


    _findProperty(propertyLookup) {
        let searchObj = {"propertyName" : propertyLookup}
        return this._searchByValue(searchObj)
        .then(data => {
            if (!data || data.versions.items.length == 0) {
                return Promise.resolve()
            }
            let versions = data.versions.items;
            return Promise.resolve(data);
        })
        .then(data => {
            if (data && data.versions && data.versions.items.length > 0) {
                return Promise.resolve(data);
            } else {
                let searchObj = {"hostname" : propertyLookup}
                return this._searchByValue(searchObj)
            }
        })
        .then(data => {
            if (data && data.versions.items.length > 0) {
                return Promise.resolve(data);
            } else {
                let searchObj = {"edgeHostname" : propertyLookup}
                return this._searchByValue(searchObj)
            }
        })
        .then(data => {
            if ((data && data.versions.items.length == 0) || !data) {
                return Promise.resolve();
            }
            let groupId = data.versions.items[0].groupId;
            let contractId = data.versions.items[0].contractId;
            let propertyId = data.versions.items[0].propertyId;
            return this._getPropertyMetadata(propertyId, groupId, contractId)
        })
        .then(property => {
            if (!property) {
                return Promise.resolve();
            }
            this._propertyByName[property.propertyName] = property;
            this._propertyById[property.propertyId] = property;
            return Promise.resolve(property);
        })
    }

    _getProperty(propertyLookup, hostnameEnvironment = LATEST_VERSION.STAGING) {
        if (propertyLookup && propertyLookup.groupId && propertyLookup.propertyId && propertyLookup.contractId)
            return Promise.resolve(propertyLookup);
        propertyLookup = propertyLookup.replace(/[^\w.-]/gi, '_');
        return this._init()
            .then(() => {
                let prop = this._propertyById[propertyLookup] || this._propertyByName[propertyLookup];
                if (!prop) {
                    let host = this._propertyByHost[propertyLookup];
                    if (host)
                        prop = hostnameEnvironment === LATEST_VERSION.STAGING ? host.staging : host.production;
                }
                if (prop) {
                    return Promise.resolve(prop);
                }
                if (!propertyLookup.match("prp_")) {
                    return this._findProperty(propertyLookup)
                } else {
                    return Promise.resolve()
                }
            })
            .then(prop => {
               if (prop) { return Promise.resolve(prop) }
               prop = this._propertyById[propertyLookup] || this._propertyByName[propertyLookup];
                if (!prop) {
                    let host = this._propertyByHost[propertyLookup];
                    if (host)
                        prop = hostnameEnvironment === LATEST_VERSION.STAGING ? host.staging : host.production;
                }

                if (!prop)
                    return Promise.reject(`Cannot find property:  ${propertyLookup}`);
                return Promise.resolve(prop);
            });
    };

    _retrieveEdgeHostnames(contractId, groupId) {
        return new Promise((resolve, reject) => {
            let request = {
                method: 'GET',
                path: `/papi/v1/edgehostnames?contractId=${contractId}&groupId=${groupId}`,
            };
            this._edge.auth(request);

            this._edge.send(function (data, response) {
                if (!response) {
                    console.error("... No response from server for edgehostname list")
                    resolve();
                } else if (response && response.statusCode >= 200 && response.statusCode < 400) {
                    let parsed = JSON.parse(response.body);
                    resolve(parsed);
                } else if (response.statusCode == 403) {
                    console.error('... no permissions, ignoring  {%s : %s}', contractId, groupId);
                    resolve(null);
                } else {
                    reject(response);
                }
            });
        });
    };

    _getPropertyList(contractId, groupId) {
        return new Promise((resolve, reject) => {
            let request = {
                method: 'GET',
                path: `/papi/v1/properties?contractId=${contractId}&groupId=${groupId}`,
            };
            this._edge.auth(request);
            this._edge.send((data, response) => {
                if (!response) {
                    console.error("... No response from server for property list")
                } else if (response && response.statusCode >= 200 && response.statusCode < 400) {
                    let parsed = JSON.parse(response.body);
                    resolve(parsed);
                } else if (response.statusCode == 403) {
                    resolve(null);
                } else {
                    reject(response);
                }
            });
        });
    };

    _getPropertyRules(propertyLookup, version, fallThrough = false) {
        return this._getProperty(propertyLookup)
            .then((data) => {
                //set basic data like contract & group
                const contractId = data.contractId;
                const groupId = data.groupId;
                const propertyId = data.propertyId;

                if (version == null) {
                    version = data.latestVersion;
                }

                return new Promise((resolve, reject) => {
                    console.error(`... retrieving property (${data.propertyName}) v${version}`);

                    let request = {
                        method: 'GET',
                        path: `/papi/v1/properties/${propertyId}/versions/${version}/rules?contractId=${contractId}&groupId=${groupId}`,
                        followRedirect: false
                    };
                    this._edge.auth(request);

                    this._edge.send(function (data, response) {
                        if (!response && fallThrough) {
                            reject("No response from server.  Please retry.");
                        } 
                        if (response && response.statusCode >= 200 && response.statusCode < 400) {
                            let parsed = JSON.parse(response.body);
                            resolve(parsed);
                        } else {
                            reject(response);
                        }
                    })
                })
            });
    }

    static _getLatestVersion(property, env = LATEST_VERSION) { 
       if (env === LATEST_VERSION.PRODUCTION)
            return property.productionVersion;
        else if (env === LATEST_VERSION.STAGING)
            return property.stagingVersion;
        else if (env === LATEST_VERSION.LATEST)
            return property.latestVersion;
        else
            return env;
    };

    _copyPropertyVersion(propertyLookup, versionId) {
        return this._getProperty(propertyLookup)
            .then((data) => {
                const contractId = data.contractId;
                const groupId = data.groupId;
                const propertyId = data.propertyId;
                const propertyName = data.propertyName;
                return new Promise((resolve, reject) => {
                    console.error(`... copy property (${propertyName}) v${versionId}`);
                    let body = {};
                    body.createFromVersion = versionId;

                    let request = {
                        method: 'POST',
                        path: `/papi/v1/properties/${propertyId}/versions?contractId=${contractId}&groupId=${groupId}`,
                        body: body
                    };

                    this._edge.auth(request);

                    this._edge.send(function (data, response) {
                        if (/application\/json/.test(response.headers['content-type'])) {
                            let parsed = JSON.parse(response.body);
                            let matches = !parsed.versionLink ? null : parsed.versionLink.match('versions/(\\d+)?');
                            if (!matches) {
                                reject(Error('cannot find version'));
                            } else {
                                resolve(matches[1]);
                            }
                        } else if (response.statusCode === 404) {
                            resolve({});
                        } else {
                            reject(response);
                        }
                    });
                });
            });
    };

    _createProperty(groupId, contractId, configName, productId, cloneFrom = null) {
        return new Promise((resolve, reject) => {
            console.error(`Creating property config ${configName}`);

            if (cloneFrom) {
                productId = cloneFrom.productId;
            }
            
            let propertyObj = {
                "cloneFrom": cloneFrom,
                "productId": productId,
                "propertyName": configName
            };

            let request = {
                method: 'POST',
                path: `/papi/v1/properties/?contractId=${contractId}&groupId=${groupId}`,
                body: propertyObj
            };

            this._edge.auth(request);

            this._edge.send(function (data, response) {
                if (response.statusCode >= 200 && response.statusCode < 400) {
                    let propertyResponse = JSON.parse(response.body);
                    response = propertyResponse["propertyLink"].split('?')[0].split("/")[4];
                    resolve(response);
                } else {
                    reject(response);
                }
            });
        })
    }

    _updatePropertyBehaviors(rules, configName, hostname, cpcode, origin = null, secure = false) {
        return new Promise((resolve, reject) => {
            let behaviors = [];
            let children_behaviors = [];
            let cpCodeExists = 0;

            rules.rules.behaviors.map(behavior => {
                if (behavior.name == "origin" && origin) {
                    behavior.options.hostname = origin;
                }
                if (behavior.name == "cpCode") {
                    cpCodeExists = 1;
                    if (behavior.options.value) {
                        behavior.options.value = { "id": Number(cpcode) };
                    } else {
                        behavior.options.cpcode = { "id": Number(cpcode) };
                    }
                }
                behaviors.push(behavior);
            })
            if (!cpCodeExists) {
                let behavior = { "options": { "value" : { "id": Number(cpcode) } } }
                behaviors.push(behavior);
            }
            rules.rules.behaviors = behaviors;

            rules.rules.children.map(child => {
                child.behaviors.map(behavior => {
                    if (behavior.name == "sureRoute") {
                        if (!behavior.options.sr_stat_key_mode && !behavior.options.testObjectUrl) {
                            behavior.options.sr_stat_key_mode = "default";
                            behavior.options.sr_test_object_url = "/akamai/sureroute-testobject.html"
                        }
                    }
                    children_behaviors.push(behavior);
                })
            })
            if (secure) {
                rules.rules.options = { "is_secure": true }
            }
            rules.rules.children.behaviors = children_behaviors;
            
            delete rules.errors;
            resolve(rules);
        })
    }

    _updatePropertyRules(propertyLookup, version, rules) {
        return this._getProperty(propertyLookup)
            .then((data) => {
                //set basic data like contract & group
                const contractId = data.contractId;
                const groupId = data.groupId;
                const propertyId = data.propertyId;
                const propertyName = data.propertyName;
                return new Promise((resolve, reject) => {
                    console.error(`... updating property (${propertyName}) v${version}`);

                    let request;

                    if (rules.ruleFormat && rules.ruleFormat != "latest" ) {
                        request = {
                                method: 'PUT',
                                path: `/papi/v1/properties/${propertyId}/versions/${version}/rules?contractId=${contractId}&groupId=${groupId}`,
                                body: rules,
                                headers: {'Content-Type':'application/vnd.akamai.papirules.' + rules.ruleFormat + '+json'}
                        }
                    } else {
                        request = {
                                method: 'PUT',
                                path: `/papi/v1/properties/${propertyId}/versions/${version}/rules?contractId=${contractId}&groupId=${groupId}`,
                                body: rules
                        }
                    }
                    
                    this._edge.auth(request);

                    this._edge.send(function (data, response) {
                        if (response.statusCode >= 200 && response.statusCode < 400) {
                            let newRules = JSON.parse(response.body);
                            resolve(newRules);
                        } else {
                            reject(response.body);
                        }
                    });
                });
            });
    };

    _createCPCode(groupId, contractId, productId, configName) {
        return new Promise((resolve, reject) => {
            console.error('Creating new CPCode for property');
            let cpCode = {
                "productId": productId,
                "cpcodeName": configName
            };
            let request = {
                method: 'POST',
                path: `/papi/v1/cpcodes?contractId=${contractId}&groupId=${groupId}`,
                body: cpCode
            };

            this._edge.auth(request);

            this._edge.send((data, response) => {
                if (response.statusCode >= 200 && response.statusCode < 400) {
                    let parsed = JSON.parse(response.body);
                    let cpcode = parsed["cpcodeLink"].split('?')[0].split("/")[4].split('_')[1];
                    resolve(cpcode);
                } else {
                    console.error("Unable to create new cpcode.  Likely this means you have reached the limit of new cpcodes for this contract.  Please try the request again with a specified cpcode");
                    resolve();
                }
            });
        });
    }

    //TODO: should only return one edgesuite host name, even if multiple are called - should lookup to see if there is alrady an existing association
    _createEdgeHostname(groupId, contractId, configName, productId, edgeHostnameId = null, edgeHostname = null, force = false, secure = false) {
        if (edgeHostnameId) {
            return Promise.resolve(edgeHostnameId);
        }
        if (edgeHostname) {
            return Promise.resolve(edgeHostname);
        }
        return new Promise((resolve, reject) => {
            console.error('Creating edge hostname for property: ' + configName);
            let hostnameObj = {
                "productId": productId,
                "domainPrefix": configName,
                "domainSuffix": "edgesuite.net",
                "secure": false,
                "ipVersionBehavior": "IPV6_COMPLIANCE",
            };

            let request = {
                method: 'POST',
                path: `/papi/v1/edgehostnames?contractId=${contractId}&groupId=${groupId}`,
                body: hostnameObj
            };

            this._edge.auth(request);

            this._edge.send((data, response) => {
                if (response.statusCode >= 200 && response.statusCode < 400) {
                    let hostnameResponse = JSON.parse(response.body);
                    response = hostnameResponse["edgeHostnameLink"].split('?')[0].split("/")[4];
                    resolve(response);
                } else {
                    reject(response);
                }
            })
        })
    }

    /**
     * Internal function to activate a property
     *
     * @param propertyLookup
     * @param versionId
     * @param env
     * @param notes
     * @param email
     * @param acknowledgeWarnings
     * @param autoAcceptWarnings
     * @returns {Promise.<TResult>}
     * @private
     */
    _activateProperty(propertyLookup, versionId, env = LATEST_VERSION.STAGING, notes = '', email = ['test@example.com'], acknowledgeWarnings = [], autoAcceptWarnings = true) {
        return this._getProperty(propertyLookup)
            .then((data) => {
                //set basic data like contract & group
                const contractId = data.contractId;
                const groupId = data.groupId;
                const propertyId = data.propertyId;
                return new Promise((resolve, reject) => {
                    console.error(`... activating property (${propertyLookup}) v${versionId} on ${env}`);

                    let activationData = {
                        propertyVersion: versionId,
                        network: env,
                        note: notes,
                        notifyEmails: email,
                        acknowledgeWarnings: acknowledgeWarnings,
                        complianceRecord: {
                            noncomplianceReason: 'NO_PRODUCTION_TRAFFIC'
                        }
                    };
                    
                    let request = {
                        method: 'POST',
                        path: `/papi/v1/properties/${propertyId}/activations?contractId=${contractId}&groupId=${groupId}`,
                        body: activationData
                    };

                    this._edge.auth(request);

                    this._edge.send(function (data, response) {
                        if (response.statusCode >= 200 && response.statusCode <= 400) {
                            let parsed = JSON.parse(response.body);
                            resolve(parsed);
                        } else {
                            reject(response.body);
                        }
                    });
                });
            })
            .then(body => {
                if (body.type && body.type.includes('warnings-not-acknowledged')) {
                    let messages = [];
                    console.error('... automatically acknowledging %s warnings!', body.warnings.length);
                    body.warnings.map(warning => {
                        console.error('Warnings: %s', warning.detail);
                        //TODO report these warnings?
                        //console.trace(body.warnings[i]);
                        messages.push(warning.messageId);
                    });
                    //TODO: check that this doesn't happen more than once...
                    return this._activateProperty(propertyLookup, versionId, env, notes, email, messages);
                } else
                    //TODO what about errors?
                    return new Promise((resolve, reject) => {
                        //TODO: chaise redirect?
                        let matches = !body.activationLink ? null : body.activationLink.match('activations/([a-z0-9_]+)\\b');

                        if (!matches) {
                            reject(body);
                        } else {
                            resolve(matches[1])
                        }
                    });
            });
    };

    //POST /platformtoolkit/service/properties/deActivate.json?accountId=B-C-1FRYVMN&aid=10357352&gid=64867&v=12
    //{"complianceRecord":{'unitTested":false,"peerReviewedBy":"","customerEmail":"","nonComplianceReason":"NO_PRODUCTION","otherNoncomplianceReason":"","siebelCase":""},"emailList":"colinb@akamai.com","network":"PRODUCTION","notes":"","notificationType":"FINISHED","signedOffWarnings":[]}

    _deactivateProperty(propertyLookup, versionId, env = LATEST_VERSION.STAGING, notes = '', email = ['test@example.com']) {
        return this._getProperty(propertyLookup)
            .then((data) => {
                //set basic data like contract & group
                const contractId = data.contractId;
                const groupId = data.groupId;
                const propertyId = data.propertyId;
                return new Promise((resolve, reject) => {
                    console.error(`... deactivating property (${propertyLookup}) v${versionId} on ${env}`);

                    let activationData = {
                        propertyVersion: versionId,
                        network: env,
                        note: notes,
                        notifyEmails: email,
                        activationType: "DEACTIVATE",
                        complianceRecord: {
                            noncomplianceReason: 'NO_PRODUCTION_TRAFFIC'
                        }

                    };
                    let request = {
                        method: 'POST',
                        path: `/papi/v1/properties/${propertyId}/activations?contractId=${contractId}&groupId=${groupId}`,
                        body: activationData
                    };

                    this._edge.auth(request);

                    this._edge.send(function (data, response) {
                        if (!response) {
                            reject();
                        }
                        if (response.statusCode >= 200 && response.statusCode <= 400) {
                            let parsed = JSON.parse(response.body);
                            let matches = !parsed.activationLink ? null : parsed.activationLink.match('activations/([a-z0-9_]+)\\b');

                            if (!matches) {
                                reject(parsed);
                            } else {
                                resolve(matches[1])
                            }
                        } else if (response.body.match('property_version_not_active')) {
                            console.error("Version not active on " + env)
                            resolve();
                        } else {
                            reject(response.body);
                        }
                    });
                });
            })
    }

    _pollActivation(propertyLookup, activationID) {
        return this._getProperty(propertyLookup)
            .then(data => {
                //set basic data like contract & group
                const contractId = data.contractId;
                const groupId = data.groupId;
                const propertyId = data.propertyId;
                return new Promise((resolve, reject) => {

                    let request = {
                        method: 'GET',
                        path: `/papi/v1/properties/${propertyId}/activations/${activationID}?contractId=${contractId}&groupId=${groupId}`,
                    };

                    this._edge.auth(request);

                    this._edge.send(function (data, response) {
                        if (response.statusCode === 200 && /application\/json/.test(response.headers['content-type'])) {
                            let parsed = JSON.parse(response.body);
                            resolve(parsed);
                        }
                        if (response.statusCode === 500) {
                            console.error('Activation caused a 500 response. Retrying...')
                            resolve({
                                activations: {
                                    items: [{
                                        status: 'PENDING'
                                    }]
                                }
                            });
                        } else {
                            reject(response);
                        }
                    });
                })
            })
            .then(data => {
                let pending = false;
                let active = false;
                data.activations.items.map(status => {
                    pending = pending || 'ACTIVE' != status.status;
                    active = !pending && 'ACTIVE' === status.status;
                });
                if (pending) {
                    console.error('... waiting 30s');
                    return sleep(30000).then(() => {
                        return this._pollActivation(propertyLookup, activationID);
                    });
                } else {
                    return active ? Promise.resolve(true) : Promise.reject(data);
                }

            });
    };

    _getAssetIds(accountId, groupId) {
        return new Promise((resolve, reject) => {
            console.error('Gathering asset ID for property');

            let request = {
                method: 'GET',
                path: `/user-admin/v1/accounts/${accountId}/groups/${groupId}/properties`
            };

            this._edge.auth(request);

            this._edge.send((data, response) => {
                if (response.statusCode >= 200 && response.statusCode < 400) {
                    let parsed = JSON.parse(response.body);
                    resolve(parsed);
                } else {
                    reject("Unable to access user administration.  Please ensure your credentials allow user admin access.");
                }
            });
        });
    }


    _moveProperty(propertyLookup, destGroup, fallThrough = false) {
        let sourceGroup, propertyId, accountId, propertyName;

        if (destGroup.match("grp_")) {
            destGroup = destGroup.substring(4);
        }

        return this._getProperty(propertyLookup)
            .then(data => {
                // User admin API uses non-PAPI strings
                // Turning grp_12345 into 12345, for
                // Group, property and account
                sourceGroup = Number(data.groupId.substring(4));
                propertyId = data.propertyId.substring(4);
                accountId = data.accountId.substring(4);
                destGroup = Number(destGroup);
                propertyName = data.propertyName;
                return this._getAssetIds(accountId, sourceGroup)
            })
            .then(assetIds => {
                let assetId;
                for (let entry of assetIds) {
                    if (entry.assetName.toLowerCase() == propertyName.toLowerCase()) {
                        assetId = entry.assetId;
                    }
                }

                if (!assetId) {
                    return Promise.reject("No matching property found");
                }
                return new Promise((resolve, reject) => {
                    let moveData = {
                        "sourceGroupId": sourceGroup,
                        "destinationGroupId": destGroup
                    }

                    let request = {
                        method: 'PUT',
                        path: `/user-admin/v1/accounts/${accountId}/properties/${assetId}`,
                        body: moveData
                    };

                    this._edge.auth(request);

                    this._edge.send(function (data, response) {
                        if (!response && fallthrough) {
                            reject();
                        } else if (!response) {
                            return this._moveProperty(propertyLookup, destGroup, 1);
                        } else if (response.statusCode == 204) {
                            console.error("Successfully moved " + propertyName + " to group " + destGroup)
                            resolve();
                        } else if (response.statusCode >= 200 && response.statusCode <= 400) {
                            resolve(response.body);
                        } else {
                            reject(response.body);
                        }
                    })
                })
            });
    }

    _deleteConfig(property) {
        return new Promise((resolve, reject) => {
            let request = {
                method: 'DELETE',
                path: `/papi/v1/properties/${property.propertyId}?contractId=${property.contractId}&groupId=${property.groupId}`
            }
            this._edge.auth(request);
            this._edge.send((data, response) => {
                let parsed = JSON.parse(response.body);
                if (response.statusCode >= 200 && response.statusCode < 400) {
                    resolve(parsed);
                } else {
                    reject(parsed);
                }
            })
        })
    }

    _assignHostnames(groupId, contractId, configName, edgeHostnameId, propertyId, hostnames, deleteHosts=null, newConfig = false) {
        let assignHostnameArray, myDelete = false;
        let newHostnameArray = [];
        let hostsToProcess = []
        let version, property;
        if (!hostnames) {
            hostnames = []
        }

        return this._getHostnameList(configName,version,false, edgeHostnameId)
            .then(hostnamelist => {
                if (hostnamelist.hostnames.items.length > 0) {
                    hostnamelist.hostnames.items.map(host => {
                        hostnames.push(host)
                        if (!edgeHostnameId) {
                            edgeHostnameId = host.cnameTo ? host.cnameTo : host.edgeHostnameId
                        }
                    })
                } 
                property = this._propertyById[propertyId];
                version = property.latestVersion;
                if (!edgeHostnameId) {
                    return Promise.reject("\n\nNo edgehostnames found for property.  Please specify edgehostname.\n\n")
                 }
            })
            .then(() => {
                return new Promise((resolve, reject) => {
                    console.error('Updating property hostnames');
                    if (deleteHosts) {
                        hostnames.map(host => {
                            myDelete = false;
                            for (let i = 0; i < deleteHosts.length; i++) {
                                if (deleteHosts[i] == host || deleteHosts[i] == host.cnameFrom) {
                                    myDelete = true;
                                }
                            }
                            if (!myDelete) {
                                hostsToProcess.push(host);
                            }
                        })
                    } else {
                        hostsToProcess = hostnames;
                    }

                    let hostSet = new Set(hostsToProcess)
                    let hostNamelist = []
                    
                    hostSet.forEach(hostname => {
                        let assignHostnameObj;
                        let skip = 0;
                        if ((hostNamelist.indexOf(hostname) != -1 || hostNamelist.indexOf(hostname.cnameFrom) != -1)) {
                            console.error("Skipping duplicate " + hostname);
                            skip = 1;
                        } else if (hostname.cnameFrom) {
                            hostNamelist.push(hostname.cnameFrom)
                            assignHostnameObj = hostname;
                        } else if (edgeHostnameId && edgeHostnameId.includes("ehn_")) {
                            assignHostnameObj = {
                                "cnameType": "EDGE_HOSTNAME",
                                "edgeHostnameId": edgeHostnameId,
                                "cnameFrom": hostname
                            }
                            hostNamelist.push(hostname)
                        } else if (edgeHostnameId) {
                            assignHostnameObj = {
                                "cnameType": "EDGE_HOSTNAME",
                                "cnameTo": edgeHostnameId,
                                "cnameFrom": hostname
                            }
                            hostNamelist.push(hostname)
                        }
                        if (!skip) {
                            console.error("Adding hostname " + assignHostnameObj["cnameFrom"]);
                            newHostnameArray.push(assignHostnameObj);
                        }
                    })

                    let request = {
                        method: 'PUT',
                        path: `/papi/v1/properties/${propertyId}/versions/${version}/hostnames/?contractId=${contractId}&groupId=${groupId}`,
                        body: newHostnameArray
                    }
                    
                    this._edge.auth(request);
                    this._edge.send((data, response) => {
                        if (response.statusCode >= 200 && response.statusCode < 400) {
                            response = JSON.parse(response.body);
                            resolve(response);
                            } else if (response.statusCode == 400 || response.statusCode == 403) {
                                reject("Unable to assign hostname.  Please try to add the hostname in 30 minutes using the --addhosts flag.")
                        } else {
                            reject(response);
                        }
                    })
                })
                })
    }

    _getEdgeHostnames() {
        return new Promise((resolve, reject) => {
            resolve(this._edgeHostnames)
        })
    }

    /**
     *
     * @param {object} data which is the output from getGroupList
     */
    _getContractAndGroup(data, contractId, groupId) {
        if (contractId && (!contractId.match("ctr_"))) {
            contractId = "ctr_" + contractId;
        }
        return new Promise((resolve, reject) => {
            if (groupId && contractId) {
                data.contractId = contractId;
                data.groupId = groupId;
                resolve(data);
            }
            data.groups.items.map(item => {
                let queryObj = {};
                if (groupId == item.groupId) {
                    data.contractId = item.contractIds[0];
                    data.groupId = item.groupId;
                    resolve(data);
                }
            });
            reject("Group/Contract combination doesn't exist");
        })
    }

    _getConfigAndHostname(configName, hostnames) {
        if (!configName && typeof hostnames != "string") {
            configName = hostnames[0];
        } else if (typeof hostnames == "string") {
            hostnames = [hostnames];
        } else if (!hostnames || hostnames.length == 0) {
            // TODO: Does this look like a hostname?
            hostnames = [configName]
        } 
        if (!configName)
            configName = hostnames[0]
        let letters = "/^[0-9a-zA-Z\\_\\-\\.]+$/";
        if (!configName.match(letters)) {
            configName = configName.replace(/[^\w.-]/gi, '_')
        }

        return ([configName, hostnames])
    }

    _setRules(groupId, contractId, productId, configName, cpcode = null, hostnames = [], origin = null, secure = false, baserules=null) {
        
        return new Promise((resolve, reject) => {
            if (cpcode) {
                return resolve(cpcode)
            } else {
                return this._createCPCode(groupId,
                    contractId,
                    productId,
                    configName)
            }
        })
            .then(data => {
                cpcode = data;
                if (baserules) {
                    return Promise.resolve(baserules)
                } else {
                    return this.retrieve(configName)
                }
            })
            .then(rules => {
                return this._updatePropertyBehaviors(rules,
                    configName,
                    hostnames[0],
                    cpcode,
                    origin,
                    secure)
            })
    }

    _getPropertyInfo(contractId, groupId, productId) {
        return this._getGroupList()
            .then(data => {
                return this._getContractAndGroup(data, contractId, groupId);
            })
            .then(data => {
                return this._getMainProduct(data.groupId, data.contractId, productId);
            })
    }

    createCPCode(property) {
        return this._createCPCode(property);
    }

    /**
 * Advanced Metadata can't be automatically replicated, but if we preserver the UUID we can. This method loops through
 * the behaviors and matches and finds advanced entries.  The PS adv. metadata check looks at the md5() of the xml
 * and the UUID of the behavior and the rule ancestry UUID. If all of these things match then the validator will allow
 * the changes to proceed.
 * @param oldRules
 * @param newRules
 * @returns updated Rules
 */
    static mergeAdvancedUUIDRules(oldRules, newRules) {
        //find behavior: {name:"advanced"} and "match": { name: "matchAdvanced"}
        //create md5 tree of ancestry ruleUUID
        //merge over other rule matches and other behaviors
        //flag changes that can't be promoted automatically

        let search = (ruleNode, parentRules = [], found = {}) => {
            let nodeList = ruleNode.behaviors.concat(ruleNode.criteria);
            nodeList.forEach(advNode => {
                //look for "advanced" behaviors
                if (advNode && (advNode.name === "advanced"
                    || advNode.name === "matchAdvanced")) {

                    let xml = advNode.options.xml || ''
                        + advNode.options.openXml || ''
                        + advNode.options.closeXml || '';
                    let newParentRules = ruleNode.uuid !== "default" ? parentRules.concat([ruleNode]) : parentRules;
                    let foundNode = {
                        uuid: advNode.uuid,
                        xml: xml,
                        advNode: advNode,
                        parentRules: newParentRules,
                        md5: md5(xml)
                    };
                    //should we allow for multiple uses of the same hash?
                    if (!found[foundNode.md5]) found[foundNode.md5] = [];
                    found[foundNode.md5].push(foundNode);
                }
            });

            if (ruleNode.children) {
                let newParentRules = ruleNode.uuid !== "default" ? parentRules.concat([ruleNode]) : parentRules;
                ruleNode.children.forEach(childRule => {
                    search(childRule, newParentRules, found);
                });
            }
            return found;
        };

        let oldAdvMtdBehaviors = search(oldRules);
        let newAdvMtdBehaviors = search(newRules);
        Object.keys(newAdvMtdBehaviors).forEach(key => {
            newAdvMtdBehaviors[key].forEach(newAdvObject => {
                let oldAdvObjectList = oldAdvMtdBehaviors[key] || [];
                let oldAdvObject = oldAdvObjectList.find(x => newAdvObject.parentRules.length === x.parentRules.length);

                if (oldAdvObject) {
                    //copy the chain of rules UUIDs over
                    for (let i = 0; i < newAdvObject.parentRules.length; i++) {

                        newAdvObject.parentRules[i].uuid = oldAdvObject.parentRules[i].uuid;
                    }
                    // copy the behavior UUID
                    newAdvObject.advNode.uuid = oldAdvObject.advNode.uuid;

                    //cleanup items in our array
                    oldAdvMtdBehaviors[key] = oldAdvMtdBehaviors[key].filter(x => x != oldAdvObject);
                } else {
                    throw Error("Cannot find Advanced Metadata in the destination rules. For safety, the Advanced behavior has to have been previously pushed on the destination config: " + newAdvObject.xml);
                }
            });
        });

        return newRules;
    }

    /**
     * Lookup the PropertyId using the associated Host name. Provide the environment if the Hostname association is
     * moving between configurations.
     *
     * @param {string} hostname for example www.example.com
     * @param {string} env for the latest version lookup (PRODUCTION | STAGING | latest)
     * @returns {Promise} the {object} of Property as the {TResult}
     */
    lookupPropertyIdFromHost(hostname, env = LATEST_VERSION.PRODUCTION) {
        return this._getProperty(hostname, env);
    }

    _getEHNId(propertyId, version, groupId, contractId) {
        return new Promise((resolve, reject) => {
            let request = {
                method: 'GET',
                path: `/papi/v1/properties/${propertyId}/versions/${version}/hostnames?contractId=${contractId}&groupId=${groupId}`
            }
            this._edge.auth(request);
            this._edge.send((data, response) => {
                if (response.statusCode >= 200 && response.statusCode < 400) {
                    response = JSON.parse(response.body);
                    resolve(response);
                } else {
                    reject(response);
                }
            })
        })

    }

    /**
     * Retrieve the rules formats for use with PAPI
     */
    _retrieveFormats() {
        return new Promise((resolve, reject) => {
            let request = {
                method: 'GET',
                path: `/papi/v1/rule-formats`
            }

            this._edge.auth(request);
            this._edge.send((data, response) => {
                if (response.statusCode >= 200 && response.statusCode < 400) {
                    response = JSON.parse(response.body);
                    resolve(response);
                } else {
                    reject(response);
                }
            })
        })
    }
    
    searchProperties(searchString, options) {
        let searchObj = {"propertyName" : searchString}
        return this._searchByValue(searchObj)
            .then(result => {
                return result;
            })
    }

    listProperties(groupId, contractId) {
        return this._listProperties(groupId, contractId)
        .then(result => {
            return result;
        })
    }

    listPropertiesToFile(groupId, contractId, toFile) {
        return this._listProperties(groupId, contractId)
        .then(result => {
            return new Promise((resolve, reject) => {
                fs.writeFile(untildify(toFile), JSON.stringify(result, '', 2), (err) => {
                    if (err)
                        reject(err);
                    else
                        resolve(result);
                });
            });
        })
    }

    retrieveGroups() {
        return this._getGroupList()
            .then(result => {
               return Promise.resolve(result.groups.items)
            })
    }

    retrieveFormats(latest=false) {
        let latestRule;
        return this._retrieveFormats()
            .then(result => {
                if (!latest) {
                    return Promise.resolve(result.ruleFormats.items)
                } else {
                    let items = result.ruleFormats.items.sort();
                    items.reverse()
                    items.forEach(function(rule) {
                        if (rule.indexOf('v2') != -1 && !latestRule) {
                            latestRule = rule
                            return Promise.resolve(rule);
                        }
                    })
                }
                return Promise.resolve(latestRule);
            })
    }

    /**
         * Retrieve the configuration rules for a given property. Use either Host or PropertyId to use as the lookup
         * for the rules
         *
         * @param {string} propertyLookup either colloquial host name (www.example.com) or canonical PropertyId (prp_123456).
         *     If the host name is moving between property configurations, use lookupPropertyIdFromHost()
         * @param {number} versionLookup specify the version or use LATEST_VERSION.PRODUCTION / STAGING / latest
         * @returns {Promise} with the property rules as the {TResult}
         */
    retrieve(propertyLookup, versionLookup = LATEST_VERSION.LATEST, hostnames=false) {
        let propertyId;
        return this._getProperty(propertyLookup)
            .then(property => {
                if (!hostnames) {
                    let version = (versionLookup && versionLookup > 0) ? versionLookup : WebSite._getLatestVersion(property, versionLookup)
                    console.error(`Retrieving ${property.propertyName} v${version}`);
                    return this._getPropertyRules(property.propertyId, version)
                } else {
                    let version = (versionLookup && versionLookup > 0) ? versionLookup : WebSite._getLatestVersion(property, versionLookup)
                    console.error(`Retrieving hostnames for ${property.propertyName} v${version}`)
                    return this._getHostnameList(property.propertyId, version);
                }
            });
    }
    /**
   * Retrieve the configuration rules for a given property. Use either Host or PropertyId to use as the lookup
   * for the rules
   *
   * @param {string} propertyLookup either colloquial host name (www.example.com) or canonical PropertyId (prp_123456).
   *     If the host name is moving between property configurations, use lookupPropertyIdFromHost()
   * @param {number} versionLookup specify the version or use LATEST_VERSION.PRODUCTION / STAGING / latest
   * @returns {Promise} with the property rules as the {TResult}
   */

    retrieveToFile(propertyLookup, toFile, versionLookup = LATEST_VERSION.LATEST) {
        return this.retrieve(propertyLookup, versionLookup)
            .then(data => {
                console.error(`Writing ${propertyLookup} rules to ${toFile}`);
                if (toFile === '-') {
                    console.log(JSON.stringify(data));
                    return Promise.resolve(data);
                } else {
                    return new Promise((resolve, reject) => {
                        fs.writeFile(untildify(toFile), JSON.stringify(data, '', 2), (err) => {
                            if (err)
                                reject(err);
                            else
                                resolve(data);
                        });
                    });
                }
            });
    }

    /**
     * Retrieve the rule format for a given property at the specified version.
     */

    retrievePropertyRuleFormat(propertyLookup, versionLookup = LATEST_VERSION.LATEST) {
        return this.retrieve(propertyLookup, versionLookup)
            .then(data => {
                console.log(JSON.stringify(data.ruleFormat));
                return Promise.resolve(data);
            });
    }

    createNewPropertyVersion(propertyLookup) {
        let property = propertyLookup;

        return this._getProperty(propertyLookup)
            .then(property => {
                let propertyName = property.propertyName;
                console.error(`Creating new version for ${propertyName}`);
                const version = WebSite._getLatestVersion(property, 0);
                property.latestVersion += 1;
                return this._copyPropertyVersion(property, version);
        })
    }
 
    /**
     *
     * @param {string} propertyLookup either colloquial host name (www.example.com) or canonical PropertyId (prp_123456).
     *     If the host name is moving between property configurations, use lookupPropertyIdFromHost()
     * @param {Object} newRules of the configuration to be updated. Only the {object}.rules will be copied.
     * @returns {Promise} with the property rules as the {TResult}
     */
    update(propertyLookup, newRules) {
        let property = propertyLookup;

        return this._getProperty(propertyLookup)
            .then(localProp => {
                property = localProp;
                let propertyName = localProp.propertyName;
                console.error(`Updating ${propertyName}`);
                const version = property.latestVersion;
                return this._copyPropertyVersion(property, version);
            })
            .then(newVersionId => {
                property.latestVersion = newVersionId;
                return this.retrieve(property, newVersionId);
            })
            .then(oldRules => {
                let updatedRules = newRules;
                // fallback in case the object is just the rules and not the full proeprty manager response
                updatedRules.rules = WebSite.mergeAdvancedUUIDRules(oldRules.rules, newRules.rules) ? newRules.rules : newRules;
                ;
                return this._updatePropertyRules(property, oldRules.propertyVersion, updatedRules);
            });
    }

    /**
     * Create a new version of a property, copying the rules from a file stream. This allows storing the property configuration
     * in a version control system and then updating the Akamai system when it becomes live. Only the Object.rules from the file
     * will be used to update the property
     *
     * @param {string} propertyLookup either colloquial host name (www.example.com) or canonical PropertyId (prp_123456).
     *     If the host name is moving between property configurations, use lookupPropertyIdFromHost()
     * @param {string} fromFile the filename to read a previously saved (and modified) form of the property configuration.
     *     Only the {Object}.rules will be copied
     * @returns {Promise} returns a promise with the updated form of the
     */
    updateFromFile(propertyLookup, srcFile) {
        return new Promise((resolve, reject) => {
            fs.readFile(untildify(srcFile), (err, data) => {
                if (err) {
                    reject(err);
            } else {
                    resolve(JSON.parse(data));
            }
            });

        })
            .then(data => {
                return this.update(propertyLookup, data)
            })
    }

    /**
     * Create a new version of a property, copying the rules from another seperate property configuration. The common use
     * case is to migrate the rules from a QA setup to the WWW setup. If the version is not provided, the LATEST version
     * will be assumed.
     *
     * @param {string} fromProperty either colloquial host name (www.example.com) or canonical PropertyId (prp_123456).
     *     If the host name is moving between property configurations, use lookupPropertyIdFromHost()
     * @param {number} fromVersion optional version number. Will assume LATEST_VERSION.LATEST if none are specified
     * @param {string} toProperty either colloquial host name (www.example.com) or canonical PropertyId (prp_123456)
     * @returns {Promise} returns a promise with the TResult of boolean
     */
    copy(fromProperty, fromVersion = LATEST_VERSION.LATEST, toProperty) {
        return this.retrieve(fromProperty, fromVersion)
            .then(fromRules => {
                console.error(`Copy ${fromProperty} v${fromRules.propertyVersion} to ${toProperty}`);
                return this.update(toProperty, fromRules)
            });
    }

    /**
     * Convenience method to promote the STAGING version of a property to PRODUCTION
     *
     * @param {string} propertyLookup either colloquial host name (www.example.com) or canonical PropertyId (prp_123456).
     *     If the host name is moving between property configurations, use lookupPropertyIdFromHost()
     * @param {string} notes describe the reason for activation
     * @param {string[]} email notivation email addresses
     * @returns {Promise} returns a promise with the TResult of boolean
     */

    //TODO: rename promoteStageToProd to activateStagingToProduction
    promoteStagingToProd(propertyLookup, notes = '', email = ['test@example.com']) {
        let stagingVersion;
        //todo: make sure email is an array
        return this._getProperty(propertyLookup)
            .then(property => {
                if (!property.stagingVersion)
                    new Promise(resolve => reject(`No version in Staging for ${propertyLookup}`));
                else if (property.productionVersion !== property.stagingVersion)
                    return this.activate(propertyLookup, stagingVersion, AKAMAI_ENV.PRODUCTION, notes, email);
                else
                    new Promise(resolve => resolve(true));
            });
    }

    /**
     * Activate a property to either STAGING or PRODUCTION. This function will poll (30s) incr. until the property has
     * successfully been promoted.
     *
     * @param {string} propertyLookup either colloquial host name (www.example.com) or canonical PropertyId (prp_123456).
     *     If the host name is moving between property configurations, use lookupPropertyIdFromHost()
     * @param {number} version version to activate
     * @param {string} networkEnv Akamai environment to activate the property (either STAGING or PRODUCTION)
     * @param {string} notes describe the reason for activation
     * @param {string[]} email notivation email addresses
     * @param {boolean} wait whether the Promise should return after activation is completed across the Akamai
     *     platform (wait=true) or if it should return immediately after submitting the job (wait=false)
     * @returns {Promise} returns a promise with the TResult of boolean
     */
    activate(propertyLookup, version = LATEST_VERSION.LATEST, networkEnv = AKAMAI_ENV.STAGING, notes = '', email = ['test@example.com'], wait = true) {
        //todo: change the version lookup

        let emailNotification = email;
        if (!Array.isArray(emailNotification))
            emailNotification = [email];
        let activationVersion = version;
        let property = propertyLookup;

        return this._getProperty(propertyLookup)
            .then(data => {
                property = data;
                if (!version || version <= 0)
                    activationVersion = WebSite._getLatestVersion(property, version);

                console.error(`Activating ${propertyLookup} to ${networkEnv}`);
                return this._activateProperty(propertyLookup, activationVersion, networkEnv, notes, emailNotification)
            })
            .then(activationId => {
                if (networkEnv === AKAMAI_ENV.STAGING)
                    property.stagingVersion = activationVersion;
                else
                    property.productionVersion = activationVersion;
                if (wait)
                    return this._pollActivation(propertyLookup, activationId);
                return Promise.resolve(activationId);
            })
    }

    /**
     * De-Activate a property to either STAGING or PRODUCTION. This function will poll (30s) incr. until the property has
     * successfully been promoted.
     *
     * @param {string} propertyLookup either colloquial host name (www.example.com) or canonical PropertyId (prp_123456).
     *     If the host name is moving between property configurations, use lookupPropertyIdFromHost()
     * @param {string} networkEnv Akamai environment to activate the property (either STAGING or PRODUCTION)
     * @param {string} notes describe the reason for activation
     * @param {Array} email notivation email addresses
     * @param {boolean} wait whether the Promise should return after activation is completed across the Akamai
     *     platform (wait=true) or if it should return immediately after submitting the job (wait=false)
     * @returns {Promise} returns a promise with the TResult of boolean
     */
    deactivate(propertyLookup, networkEnv = AKAMAI_ENV.STAGING, notes = '', email = ['test@example.com'], wait = true) {
        if (!Array.isArray(email))
            email = [email];
        let property;

        return this._getProperty(propertyLookup)
            .then(data => {
                property = data;
                console.error(`Deactivating ${propertyLookup} to ${networkEnv}`);
                let deactivationVersion = WebSite._getLatestVersion(property, networkEnv == AKAMAI_ENV.STAGING ? LATEST_VERSION.STAGING : LATEST_VERSION.PRODUCTION) || 1;
                return this._deactivateProperty(propertyLookup, deactivationVersion, networkEnv, notes, email)
            })
            .then(activationId => {
                if (!activationId) {
                    return Promise.resolve();
                }
                if (networkEnv === AKAMAI_ENV.STAGING)
                    property.stagingVersion = null;
                else
                    property.productionVersion = null;
                if (wait)
                    return this._pollActivation(propertyLookup, activationId);
                return Promise.resolve(activationId);
            })
    }

    assignEdgeHostname(propertyLookup, version = 0, edgeHostname) {
        let contractId,
            groupId,
            productId,
            propertyId,
            configName;

        return this._getProperty(propertyLookup)
            .then(data => {
                version = WebSite._getLatestVersion(data, version)
                contractId = data.contractId;
                groupId = data.groupId;
                configName = data.propertyName;
                propertyId = data.propertyId;
                return this._assignHostnames(groupId,
                    contractId,
                    configName,
                    edgeHostname,
                    propertyId,
                    null,
                    null);
            }).then(data => {
                return Promise.resolve();
            })
    }

    /**
     * Deletes the specified property from the contract
     *
     * @param {string} property Lookup either colloquial host name (www.example.com) or canonical PropertyId (prp_123456).
     *     If the host name is moving between property configurations, use lookupPropertyIdFromHost()
     */
    deleteProperty(propertyLookup) {
        //TODO: deactivate first
        return this._getProperty(propertyLookup)
            .then(property => {
                console.error(`Deleting ${propertyLookup}`);
                return this._deleteConfig(property)
            })
    }

    /**
     * Moves the specified property to a new group
     *
     * @param {string} property Lookup either colloquial host name (www.example.com) or canonical PropertyId (prp_123456).
     *     If the host name is moving between property configurations, use lookupPropertyIdFromHost()
     */
    moveProperty(propertyLookup, destGroup) {
        //TODO: deactivate first
        console.error(`Moving ${propertyLookup} to ` + destGroup);

        return this._moveProperty(propertyLookup, destGroup)
    }

    setRuleFormat(propertyLookup, version, ruleformat) {
        
        return this._getProperty(propertyLookup)
            .then(data => {
                version = WebSite._getLatestVersion(data, version)
                return this._getPropertyRules(propertyLookup, version)
            })
            .then(rules => {
                rules.ruleFormat = ruleformat;
                return this._updatePropertyRules(propertyLookup, version, rules);
            })
    }

    setCpcode(propertyLookup, version, cpcode) {
        return this._getProperty(propertyLookup)
            .then(data => {
                version = WebSite._getLatestVersion(data, version)
                return this._getPropertyRules(propertyLookup, version)
            })
            .then(rules => {
                let behaviors = [];
                let cpCodeExists = 0;
                rules.rules.behaviors.map(behavior => {
                    if (behavior.name == "cpCode") {
                        cpCodeExists = 1;
                        behavior.options.value.id = cpcode
                    }
                    behaviors.push(behavior)
                })
                if (!cpCodeExists) {
                    let behavior = { "name":"cpCode", "options": { "value" : { "id": Number(cpcode) } } }
                    behaviors.push(behavior);
                }
     
                rules.rules.behaviors = behaviors;
                return this._updatePropertyRules(propertyLookup, version, rules);
            })
    }

    delHostnames(propertyLookup, version, hostnames) {
        let contractId,
            groupId,
            productId,
            propertyId,
            configName,
            hostlist;

        let names = this._getConfigAndHostname(propertyLookup, hostnames);
        configName = names[0];
        hostnames = names[1];


        return this._getProperty(propertyLookup)
            .then(data => {
                version = WebSite._getLatestVersion(data, 0)
                contractId = data.contractId;
                groupId = data.groupId;
                configName = data.propertyName;
                propertyId = data.propertyId;
                return this._getHostnameList(configName, version)
            })
            .then(hostnamelist => {
                hostlist = hostnamelist.hostnames.items;
                return this._assignHostnames(groupId,
                    contractId,
                    configName,
                    null,
                    propertyId,
                    null,
                    hostnames);
            }).then(data => {
                return Promise.resolve();
            })
    }

    addHostnames(propertyLookup, version = 0, hostnames, edgeHostname = null) {
        let contractId,
            groupId,
            productId,
            propertyId,
            configName,
            hostlist;
            
        let names = this._getConfigAndHostname(propertyLookup, hostnames);
        configName = names[0];
        hostnames = names[1];

        return this._getProperty(configName)
            .then(data => {
                version = WebSite._getLatestVersion(data, version)

                contractId = data.contractId;
                groupId = data.groupId;
                configName = data.propertyName;
                propertyId = data.propertyId;
                return this._getMainProduct(groupId, contractId, null)
            })
            .then(product => {
                productId = product.productId;
                return this._getHostnameList(configName, version)
            })
            .then(hostnamelist => {
                let ehn = edgeHostname;
                hostlist = hostnamelist.hostnames.items;
                if (hostlist.length > 0 && !edgeHostname) {
                    ehn = hostlist[0]["edgeHostnameId"]
                    if (!ehn) {
                        ehn = hostlist[0]["cnameTo"]
                    }
                }
                return Promise.resolve(ehn)
            })
            .then(edgeHostnameId => {
                return this._assignHostnames(groupId,
                    contractId,
                    configName,
                    edgeHostnameId,
                    propertyId,
                    hostnames);
            }).then(data => {
                return Promise.resolve();
            })
    }

    setVariables(propertyLookup, version = 0, variablefile) {
        let changeVars = {
            "delete": [],
            "create": [],
            "update": []
        };

        let variables;

        return new Promise((resolve, reject) => {
            fs.readFile(untildify(variablefile), (err, data) => {
                if (err)
                    reject(err);
                else
                    variables = JSON.parse(data);
                    resolve(JSON.parse(data));
                });
            })
            .then(()=> {
                return this._getProperty(propertyLookup)
            })
            .then(data => {
                version = WebSite._getLatestVersion(data, version)
            })
            .then(data => {
                data = variables;
                data.map(variable => {
                    variable.action.map(action => {
                        changeVars[action].push(variable);
                    })
                })
                return this._getPropertyRules(propertyLookup, version)
            })
            .then(data => {
                let newVars = data.rules.variables || [];

                changeVars['create'].map(variable => {

                    let index_check = newVars.findIndex(elt => elt.name == variable.name);

                    if (index_check < 0) {
                        delete variable.action;
                        newVars.push(variable)
                        changeVars['update'].splice(
                            changeVars['update'].findIndex(
                                elt => elt.name === variable.name
                            )
                        )
                    } else {
                        console.error("... not creating existing variable " + variable.name)
                    }
                })

                changeVars['delete'].map(variable => {
                    newVars.splice(
                        newVars.findIndex(
                            elt => elt.name === variable.name)
                    )
                    console.error("... deleting variable " + variable.name)
                })

                changeVars['update'].map(variable => {
                    let ind = newVars.findIndex(elt => elt.name == variable.name);
                    if (ind >= 0) {
                        delete variable.action;
                        console.error("... updating existing variable " + variable.name)
                        newVars[ind] = variable;
                    }
                })

                data.rules.variables = newVars;

                return Promise.resolve(data);
            })
            .then(rules => {
                return this._updatePropertyRules(propertyLookup, version, rules);
            })
    }

    getVariables(propertyLookup, versionLookup=0, filename=null) {       
        return this._getProperty(propertyLookup)
            .then(property => {
                    let version = (versionLookup && versionLookup > 0) ? versionLookup : WebSite._getLatestVersion(property, versionLookup)
                    console.error(`Retrieving variables for ${property.propertyName} v${version}`);
                    return this._getPropertyRules(property.propertyId, version)
            })
            .then(rules => {
                if (!filename) {
                    console.log(JSON.stringify(rules.rules.variables, '', 2));
                    return Promise.resolve();
                } else {
                    return new Promise((resolve, reject) => {
                        fs.writeFile(untildify(filename), JSON.stringify(rules.rules.variables, '', 2), (err) => {
                            if (err)
                                reject(err);
                            else
                                resolve(rules);
                        });
                    });
                }
            })
    }

    setComments(propertyLookup, version = 0, comment) {
        console.error("... adding version notes")
        return this._getProperty(propertyLookup)
            .then(property => {
                version = WebSite._getLatestVersion(property, version);
                return this._getPropertyRules(property, version)
            })
            .then(data => {
                data.comments = comment;
                return Promise.resolve(data);
            })
            .then(rules => {
                return this._updatePropertyRules(propertyLookup, version, rules);
            })
    }
    
    setOrigin(propertyLookup, version = 0, origin, forward) {
        let forwardHostHeader;
        let customForward = "";
        
        if (forward == "origin") {
            forwardHostHeader = "ORIGIN_HOSTNAME"
        } else if (forward == "incoming") {
            forwardHostHeader = "REQUEST_HOST_HEADER"
        } else if (forward) {
            forwardHostHeader = "CUSTOM"
            customForward = forward
        }
        return this._getProperty(propertyLookup)
            .then(property => {
                version = WebSite._getLatestVersion(property, version);
                return this._getPropertyRules(property, version)
            })
            .then(data => {
                let behaviors = [];
                data.rules.behaviors.map(behavior => {
                    if (behavior.name == "origin") {
                        if (origin) {
                            behavior.options.hostname = origin;
                        }
                        if (forwardHostHeader) {
                            behavior.options.forwardHostHeader = forwardHostHeader;
                            if (customForward) {
                                behavior.options.customForwardHostHeader = customForward;
                            } else {
                                delete (behavior.options.customForwardHostHeader);
                            }
                        }
                    }
                    behaviors.push(behavior);
                })
                data.rules.behaviors = behaviors;
                return Promise.resolve(data);
            })
            .then(rules => {
                return this._updatePropertyRules(propertyLookup, version, rules);
            })
    }

    setSureRoute(propertyLookup, version=0, sureroutemap, surerouteto, sureroutetohost) {
        return this._getProperty(propertyLookup)
            .then(property => {
                version = WebSite._getLatestVersion(property, version);
                return this._getPropertyRules(property, version)
            })
            .then(data => {
                let children = [];
                data.rules.children.map(child => {
                    let behaviors = []
                    child.behaviors.map(behavior => {
                        if (behavior.name == "sureRoute") {
                            if (sureroutemap) {
                                behavior.options.customMap = sureroutemap;
                                behavior.options.type = "CUSTOM_MAP";
                            }
                            if (surerouteto) {
                                behavior.options.testObjectUrl = surerouteto;
                            }
                            if (sureroutetohost) {
                                behavior.options.toHost = sureroutetohost;
                                behavior.options.toHostStatus = "OTHER";
                            }
                        }
                        behaviors.push(behavior);
                    })
                    child.behaviors = behaviors;
                    children.push(child)
                })
                
                data.rules.children = children;
                return Promise.resolve(data);   
            })
            .then(rules => {
                return this._updatePropertyRules(propertyLookup,version,rules);
            })
    }

    /** 
     * Adds specified hostnames to the property
     * 
     * @param {string}
    */

    /**
     * Creates a new property from scratch
     *
     * @param {array} hostnames List of hostnames for the property
     * @param {string} cpcode
     * @param {string} configName
     * @param {string} contractId
     * @param {string} groupId
     * @param {object} newRules
     * @param {string} origin
     */

    create(hostnames = [],  cpcode = null, 
                            configName = null, 
                            contractId = null, 
                            groupId = null, 
                            newRules = null, 
                            origin = null, 
                            edgeHostname = null, 
                            secure = false,
                            productId = null) {

        let newEdgeHostname;
        if (!configName && !hostnames) {
            return Promise.reject("Configname or hostname is required.")
        }

        if (!groupId) {
            return Promise.reject("Group ID is required.")
        }

        if (edgeHostname == null) {
            console.error("EdgeHostname should be specified as new edge hostnames take several minutes to appear.")
            newEdgeHostname = 1;
        }

        let names = this._getConfigAndHostname(configName, hostnames);
        configName = names[0];
        hostnames = names[1];
        
        if (!origin) {
            origin = "origin-" + configName;
        }
        
        let propertyId,
        edgeHostnameId;

        return this._getPropertyInfo(contractId, groupId, productId)
            .then(data => {
                groupId = data.groupId;
                contractId = data.contractId;
                productId = data.productId;
                return this._createProperty(groupId,
                    contractId,
                    configName,
                    productId);
            })
            .then(data => {
                propertyId = data;
                return this.searchProperties(configName);
            })
            .then(data => {
                propertyId = data["versions"]["items"][0]["propertyId"]
                contractId = data["versions"]["items"][0]["contractId"]
                groupId = data["versions"]["items"][0]["groupId"]
                
                return this._getNewProperty(propertyId, groupId, contractId);
            })
            .then(data => {
                let propInfo = data.properties.items[0];
                this._propertyByName[propInfo.propertyName] = propInfo;
                this._propertyById[propInfo.propertyId] = propInfo;
                this._propertyByName[configName] = propInfo;

                return this._setRules(groupId, contractId, productId, configName, cpcode, hostnames, origin, secure, newRules)
            })
            .then(rules => {
                return this._updatePropertyRules(configName,
                    1,
                    rules);
            })
            .then(data => {
                return this._retrieveEdgeHostnames(contractId, groupId)
            })
            .then(data => {
                let ehn_exists = 0;
                data.edgeHostnames.items.map(hostname => {
                    if (hostname.domainPrefix = configName) {
                        ehn_exists = 1;
                    }
                })
                
                if (edgeHostname) {
                    if (edgeHostname.indexOf("edgekey") > -1) {
                        secure = true;
                    }
                    edgeHostnameId = edgeHostname;
                    return Promise.resolve(edgeHostname);
                } else if (data.edgeHostnameId) {
                    edgeHostnameId = data.edgeHostnameId;
                    return Promise.resolve(edgeHostnameId);
                } else {
                    edgeHostnameId = configName;
                    if (!ehn_exists) {
                        return this._createEdgeHostname(groupId,
                            contractId,
                            configName,
                            productId,
                            null,
                            edgeHostname);
                    } else {
                        return Promise.resolve();
                    }
                }
            })
            .then(edgeHostnameId => {
                if (newEdgeHostname) {
                    console.error("Edge hostnames take 30 minutes to appear.  Please use modify to add the hostname at that point.")
                    return Promise.resolve()
                } else {
                    return this._assignHostnames(groupId,
                        contractId,
                        configName,
                        edgeHostnameId,
                        propertyId,
                        hostnames,
                        false,
                        true);
                    }
            }).then(() => {
                return Promise.resolve();
            })
    }

    createFromFile(hostnames = [], srcFile, configName = null, contractId = null, groupId = null, cpcode = null, origin = null, edgeHostname = null, ruleformat = null, productId = null) {
        let names = this._getConfigAndHostname(configName, hostnames);
        configName = names[0];
        hostnames = names[1];
        return new Promise((resolve, reject) => {
            fs.readFile(untildify(srcFile), (err, data) => {
                if (err)
                    reject(err);
                else
                    resolve(JSON.parse(data));
            });
        })
        .then(rules => {
            if (!groupId) {
                    groupId = rules.groupId;
            }
            if (!contractId) {
                contractId = rules.contractId;
            }
            rules.rules.behaviors.map(behavior => {
                if (behavior.name == "cpCode" && !cpcode) {
                   cpcode = behavior.options.value.id
                }
            })
            return this.create(hostnames, cpcode, configName, contractId, groupId, rules, origin, edgeHostname, ruleformat, productId);
        })
    }

    createFromExisting(configName, options) {
        let srcProperty = options.clone
        let srcVersion = options.srcver || LATEST_VERSION.LATEST
        let copyHostnames = options.nocopy || false
        let hostnames = options.hostnames || []
        let contractId = options.contract || null
        let groupId = options.group || null
        let origin = options.origin || null
        let edgeHostname = options.edgehostname || null
        let cpcode = options.cpcode || null
        let ruleformat = options.ruleformat || null
        let secure = options.secure || false
        
        let names = this._getConfigAndHostname(configName, hostnames);
        configName = names[0];
        hostnames = names[1];

        let cloneFrom,
            productId,
            productName,
            propertyId,
            edgeHostnameId,
            newEdgeHostname,
            latestFormat;

        return this._getProperty(srcProperty)
            .then(data => {
                return this._getCloneConfig(srcProperty, srcVersion = srcVersion)
            })
            .then(data => {
                cloneFrom = data;
                productId = data.productId;
                
                if (!cpcode) {
                    cpcode = data.cpcode;
                }
                if (!groupId) {
                    groupId = data.groupId;
                    contractId = data.contractId;
                }
                if (edgeHostname) {
                    if (edgeHostname.indexOf("edgekey") > -1) {
                        secure = true;
                    }
                    edgeHostnameId = edgeHostname;
                } else {
                    newEdgeHostname = 1;
                }
                return this._getEHNId(data.propertyId, data.version, groupId, contractId)
            })
               
            .then(clone_ehn =>{
                if ((clone_ehn.hostnames.items) && (!edgeHostnameId)) {
                        edgeHostnameId = clone_ehn.hostnames.items[0].cnameTo || clone_ehn.hostnames.items[0].edgeHostnameId;
                }
                return Promise.resolve(edgeHostnameId)
            })
            /*.then(edgeHostnameId => {
                return this._createEdgeHostname(groupId,
                    contractId,
                    configName,
                    productId,
                    edgeHostnameId,
                    edgeHostname);
            })*/
            .then(data => {
                edgeHostnameId = data;
                return this._createProperty(groupId,
                    contractId,
                    configName,
                    productId,
                    cloneFrom);
            })
            .then(data => {
                propertyId = data;
                return this._getNewProperty(propertyId, groupId, contractId);
            })
            .then(data => {
                let propInfo = data.properties.items[0];
                this._propertyByName[propInfo.propertyName] = propInfo;
                this._propertyById[propInfo.propertyId] = propInfo;
                this._propertyByName[configName] = propInfo;
                return this.retrieveFormats(true)
            })
            .then(format => {
                latestFormat = format;
                return this._setRules(groupId, contractId, productId, configName, cpcode, hostnames, origin, secure)
            })
            .then(rules => {
                rules.ruleFormat = latestFormat;
                return this._updatePropertyRules(configName,
                    1,
                    rules);
            })
            /*.then(property => {
                return this._assignHostnames(groupId,
                        contractId,
                        configName,
                        edgeHostnameId,
                        propertyId,
                        hostnames,
                        false,
                        true);
                        
            })*/
            .then(data => {
                return Promise.resolve();
            })
    }
}


WebSite.AKAMAI_ENV = Object.freeze(AKAMAI_ENV);
WebSite.LATEST_VERSION = Object.freeze(LATEST_VERSION);

module.exports = WebSite;
