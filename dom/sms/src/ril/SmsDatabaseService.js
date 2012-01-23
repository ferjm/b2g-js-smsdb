/* -*- Mode: C++; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* ***** BEGIN LICENSE BLOCK *****
 * Version: MPL 1.1/GPL 2.0/LGPL 2.1
 *
 * The contents of this file are subject to the Mozilla Public License Version
 * 1.1 (the "License"); you may not use this file except in compliance with
 * the License. You may obtain a copy of the License at
 * http://www.mozilla.org/MPL/
 *
 * Software distributed under the License is distributed on an "AS IS" basis,
 * WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License
 * for the specific language governing rights and limitations under the
 * License.
 *
 * The Original Code is mozilla.org code.
 *
 * The Initial Developer of the Original Code is Mozilla Foundation
 * Portions created by the Initial Developer are Copyright (C) 2011
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *   Philipp von Weitershausen <philipp@weitershausen.de>
 *   Fernando Jiménez Moreno <ferjm@tid.es>
 *
 * Alternatively, the contents of this file may be used under the terms of
 * either of the GNU General Public License Version 2 or later (the "GPL"),
 * or the GNU Lesser General Public License Version 2.1 or later (the "LGPL"),
 * in which case the provisions of the GPL or the LGPL are applicable instead
 * of those above. If you wish to allow use of your version of this file only
 * under the terms of either the GPL or the LGPL, and not to allow others to
 * use your version of this file under the terms of the MPL, indicate your
 * decision by deleting the provisions above and replace them with the notice
 * and other provisions required by the GPL or the LGPL. If you do not delete
 * the provisions above, a recipient may use your version of this file under
 * the terms of any one of the MPL, the GPL or the LGPL.
 *
 * ***** END LICENSE BLOCK ***** */

"use strict";

const {classes: Cc, interfaces: Ci, utils: Cu, results: Cr} = Components;

Cu.import("resource://gre/modules/XPCOMUtils.jsm");

const SMS_DATABASE_SERVICE_CID = Components.ID("{799c2cc0-45de-11e1-b86c-0800200c9a66}");
const SMS_DATABASE_SERVICE_CONTRACTID = "@mozilla.org/smsdatabaseservice;1";

const DB_NAME = "sms";
const DB_VERSION = 1;
const STORE_NAME = "sms";

const DELIVERY_RECEIVED = "received"
const DELIVERY_SENT = "sent";

//TODO: own number must be retrieved somehow from the RIL
const CURRENT_ADDRESS = "+34666222111";


/**
 * SmsDatabaseError
 */
const UNKNOWN_ERROR           = 0;
const INVALID_ARGUMENT_ERROR  = 1;
const TIMEOUT_ERROR           = 2;
const PENDING_OPERATION_ERROR = 3;
const IO_ERROR                = 4;
const NOT_SUPPORTED_ERROR     = 5;
const PERMISSION_DENIED_ERROR = 20;

function SmsDatabaseError(code) {
  this.code = code;
}
SmsDatabaseError.prototype = {
  UNKNOWN_ERROR:           UNKNOWN_ERROR,
  INVALID_ARGUMENT_ERROR:  INVALID_ARGUMENT_ERROR,
  TIMEOUT_ERROR:           TIMEOUT_ERROR,
  PENDING_OPERATION_ERROR: PENDING_OPERATION_ERROR,
  IO_ERROR:                IO_ERROR,
  NOT_SUPPORTED_ERROR:     NOT_SUPPORTED_ERROR,
  PERMISSION_DENIED_ERROR: PERMISSION_DENIED_ERROR
};


/**
 * SmsDatabase
 */
function SmsDatabase() {
}
SmsDatabase.prototype = {

  init: function(indexDB) {
    this._indexedDB = indexDB;
  },

  /**
   * Cache the DB here.
   */
   db: null,

  /**
   * Prepare the database. This may include opening the database and upgrading
   * it to the latest schema version.
   *
   * @return (via callback) a database ready for use.
   */
  ensureDB: function ensureDB(callback, failureCb) {
    if (this.db) {
      debug("ensureDB: already have a database, returning early.");
      callback(this.db);
      return;
    }

    let self = this;
    function gotDB(db) {
      self.db = db;
      callback(db);
    }

    let request = this._indexedDB.open(DB_NAME, DB_VERSION);
    request.onsuccess = function (event) {
      debug("Opened database:", DB_NAME, DB_VERSION);
      gotDB(event.target.result);
    };
    request.onupgradeneeded = function (event) {
      debug("Database needs upgrade:", DB_NAME,
            event.oldVersion, event.newVersion);
      debug("Correct new database version:", event.newVersion == DB_VERSION);

      let db = event.target.result;

      switch (event.oldVersion) {
        case 0:
          debug("New database");
          self.createSchema(db);
          break;

        default:
          debug("No idea what to do with old database version:",
                event.oldVersion);
          event.target.transaction.abort();
          failureCb(new SmsDatabaseError(IO_ERROR));
          break;
      }
    };
    request.onerror = function (event) {
      debug("Failed to open database:", DB_NAME);
      //TODO look at event.target.Code and change error constant accordingly
      failureCb(new SmsDatabaseError(IO_ERROR));
    };
    request.onblocked = function (event) {
      debug("Opening database request is blocked.");
      failureCb(new SmsDatabaseError(IO_ERROR));
    };
  },

  /**
   * Create the initial database schema.
   *
   * The schema of records stored, according to nsIDOMMozSmsMessage is as
   * follows:
   *
   * {
   *  id:        number,     // UUID.
   *  properties {
   *    delivery:  number,   // Should be "sent" or "received" //TODO: howto enum type??
   *    sender:    string,   // Address of the sender of the Sms.
   *    receiver:  string,   // Address of the receiver of the Sms //TODO: shouldn´t be []
   *    body:      string,   // Content of the Sms.
   *    date:      date,     // Date of the delivery of the Sms.
   *  }
   * }
   */
  createSchema: function createSchema(db) {
    let objectStore = db.createObjectStore(STORE_NAME, {keyPath: "id"});

    // Metadata indexes
    objectStore.createIndex("id", "id", { unique: true });

    // Index for the Sms addresses
    // TODO: Check this: I understand the indexes as a way for quick searching
    //       As we probably want to search by sender, receiver and date,
    //       we need the following indexes.
    objectStore.createIndex("delivery", "properties.delivery", { unique: false });
    objectStore.createIndex("sender", "properties.sender", { unique: false });
    objectStore.createIndex("receiver", "properties.receiver", { unique: false });
    objectStore.createIndex("date", "properties.date", { unique:false });

    debug("Created object stores and indexes");
  },

  /**
   * Start a new transaction.
   *
   * @param txn_type
   *        Type of transaction (e.g. IDBTransaction.READ_WRITE)
   * @param callback
   *        Function to call when the transaction is available. It will
   *        be invoked with the transaction and the 'sms' object store.
   * @param successCb [optional]
   *        Success callback to call on a successful transaction commit.
   * @param failureCb [optional]
   *        Error callback to call when an error is encountered.
   */
  newTxn: function newTxn(txn_type, callback, successCb, failureCb) {
    this.ensureDB(function (db) {
      debug("Starting new transaction", txn_type);
      let txn = db.transaction([STORE_NAME], txn_type);
      debug("Retrieving object store", STORE_NAME);
      let store = txn.objectStore(STORE_NAME);

      txn.oncomplete = function (event) {
        debug("Transaction complete. Returning to callback.");
        successCb(txn.result);
      };
      // The transaction will automatically be aborted.
      txn.onerror = function (event) {
        debug("Caught error on transaction", event.target.errorCode);
        //TODO look at event.target.errorCode and change error constant accordingly
        failureCb(new SmsDatabaseError(UNKNOWN_ERROR));
      };

      callback(txn, store);
    }, failureCb);
  },

  /**
   * Create a new Sms object.
   *
   * @param record
   *        A record as stored in IndexedDB
   * @param properties [optional]
   *        Object containing initial field values
   *
   * @return an Sms object.
   *
   * The returned Sms object closes over the IndexedDB record.
   */
  makeSms: function makeSms(record,
                            properties) {
    let smsDatabase = this;

    let sms = record.properties;
    if (!sms) {
      sms = record.properties = {
        delivery:   null,
        sender:     null,
        receiver:   null,
        body:       null,
        date:       null
      };
    }

    for (let field in properties) {
      sms[field] = properties[field];
    }

    // Use Object.defineProperty() to ensure these methods aren´t
    // writeable, configurable, enumerable.
    Object.defineProperty(sms, "save",
                          {value: function save(successCb, errorCb){
      smsDatabase.saveSms(record, successCb, errorCb);
    }});

    Object.defineProperty(sms, "remove",
                          {value: function remove(successCb, errorCb) {
      smsDatabase.deleteMessage(successCb, errorCb);
    }});
    //TODO: getter and setter are not working :(
    /*
    Object.defineProperty(sms, "id", {enumerable: true,
                                      get: function () {
      return sms.id;
    },                                set: function(id) {
      sms.id = id;
    }});*/

    Object.seal(sms);
    return sms;
  },

  updateRecordMetadata: function updateRecordMetadata(record) {
    if (!record.id) {
      record.id = generateUUID();
    }
  },

  /**
   * Put an SMS in the DB.
   *
   * @param record
   *        A record as stored in the DB.
   * @param successCb
   *        Callback function to invoque with the record id.
   * @param errorCb
   *        Callback function to invoque when there was an error.
   */
  saveSms: function saveSms(record, successCb, errorCb) {
    //TODO: verify record
    this.newTxn(IDBTransaction.READ_WRITE, function(txn, store) {
      this.updateRecordMetadata(record);
      store.put(record);
      txn.result = record;
    }.bind(this), successCb, errorCb);
  },

  /**
   * Deletes an SMS from the DB.
   *
   * @param recordId
   *        UID of the record to remove.
   * @param successCb
   *        Callback to invoque when successfully delete the SMS.
   * @param errorCb
   *        Callback to invoque when there was an error.
   */
  removeSms: function removeSms(recordId, successCb, errorCb) {
    this.newTxn(IDBTransaction.READ_WRITE, function(txn, store) {
      debug("Going to delete sms with id: ", recordId);
      store.delete(recordId);
    }, successCb, errorCb);
  },

  /**
   * Find a record in the DB
   *
   * @param successCb
   *        Callback function to invoke with result array.
   * @param failureCb
   *        Callback function to invoke when there was an error.
   * @param options [optional]
   *        Objects specifying search options. Possible attributes:
   *        - filterOp
   */
  find: function find(successCb, failureCb, options) {
    let self = this;
    this.newTxn(IDBTransaction.READ_ONLY, function (txn, store) {
      if (options && options.filterOp == "equals") {
        self._findWithIndex(txn, store, options);
      } else {
        self._findAll(txn, store);
      }
    }, successCb, failureCb);
  },

  _findAll: function _findAll(txn, store) {
    //TODO: change getAll. It is not part of indexeddb standard
    store.getAll().onsuccess = function (event) {
      console.log("Request successful. Record count: ",
                  event.target.result.length);
      txn.result = event.target.result.map(this.makeSms.bind(this));
    }.bind(this);
  },

  _findWithIndex: function _findWithIndex(txn, store, options) {
    //TODO verify options.filterBy is an array

    let filter_keys = options.filterBy.slice();
    //TODO check whether filter_keys are valid filters.

    let request;
    // Query records by first filter. Apply any extra filters later.
    let key = filter_keys.shift();
    //TODO check whether filter_key is a valid index
    debug("Getting index", key);
    let index = store.index(key);
    //TODO: change getAll. It is not part of the standard.
    request = index.getAll(options.filterValue);

    request.onsuccess = function (event) {
      console.log("Request successful. Record count:",
                  event.target.result.length);
      txn.result = event.target.result.map(this.makeSms.bind(this));
      //TODO filter additional keys
    }.bind(this);
  },

  /**
  * Generate a UUID according to RFC4122 v4 (random UUIDs)
  * TODO: Maybe this function could be replaced for some gecko uuid generator
  *       component.
  */
  generateUUID: function generateUUID() {
    var chars = '0123456789abcdef';
    var uuid = [];
    var choice;

    uuid[8] = uuid[13] = uuid[18] = uuid[23] = '-';
    uuid[14] = '4';

    for (var i = 0; i < 36; i++) {
      if (uuid[i]) {
        continue;
      }
      choice = Math.floor(Math.random() * 16);
      // Set bits 6 and 7 of clock_seq_hi to 0 and 1, respectively.
      // (cf. RFC4122 section 4.4)
      uuid[i] = chars[(i == 19) ? (choice & 3) | 8 : choice];
    }

    return uuid.join('');
  }
};



/**
 * SmsDatabaseService
 */
// TODO: Is this the correct way to create an XPCOM service??
//       https://alexvincent.us/blog/?p=453
var smsDatabaseService = null;

function getGlobal() {
  return (function() {
    return this;
  }).call(null);
}

function SmsDatabaseService() {
  if (smsDatabaseService) {
    let idbManager = Components.classes["@mozilla.org/dom/indexeddb/manager;1"].getService(Ci.nsIIndexedDatabaseManager);
    idbManager.init(getGlobal());
    this._indexedDB = idbManager.createFactory();
    this._db = new SmsDatabase();
    this._db.init(this._indexedDB);
    return smsDatabaseService;
  }
  smsDatabaseService = this;
}
SmsDatabaseService.prototype = {
  classID: SMS_DATABASE_SERVICE_CID,
  classInfo: XPCOMUtils.generateCI({classID: SMS_DATABASE_SERVICE_CID,
                                    contractID: SMS_DATABASE_SERVICE_CONTRACTID,
                                    interfaces: [Ci.nsISmsDatabaseService],
                                    classDescription: "SmsDatabaseService"}),
  QueryInterface: XPCOMUtils.generateQI([Ci.nsISmsDatabaseService]),

  saveSentMessage: function saveSentMessage(aReceiver, aBody, aDate) {
    debug("saveSentMessage");
  }
};

function NSGetModule(compMgr, fileSpec) {
  return XPCOMUtils.generateModule([SmsDatabaseService]);
}

let debug;
if (DEBUG) {
  debug = function (s) {
    dump("-*- SmsDatabaseService component: " + s + "\n");
  };
} else {
  debug = function (s) {};
}
