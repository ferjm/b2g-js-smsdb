/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

//const {classes: Cc, interfaces: Ci, utils: Cu, results: Cr} = Components;

//Cu.import("resource://gre/modules/XPCOMUtils.jsm");
//Cu.import("resource://gre/modules/Services.jsm");

//const SMS_DATABASE_SERVICE_CONTRACTID = "@mozilla.org/sms/smsdatabaseservice;1";
//const SMS_DATABASE_SERVICE_CID = Components.ID("{2454c2a1-efdd-4d96-83bd51a29a21f5ab}");

const DEBUG = true;
const DB_NAME = "sms";
const DB_VERSION = 1;
const STORE_NAME = "sms";

const eNoError = 0;
const eNoSignalError = 1;
const eNotFoundError = 2;
const eUnknownError = 3;
const eInternalError = 4;

const DELIVERY_RECEIVED = "received";
const DELIVERY_SENT = "sent";

// TODO: own number must be retrieved from the RIL
const CURRENT_ADDRESS = "+34666222111"; 

/*XPCOMUtils.defineLazyServiceGetter(this, "gSmsService",
                                   "@mozilla.org/sms/smsservice;1",
                                   "nsISmsService");
//TODO see bug 720632
XPCOMUtils.defineLazyServiceGetter(this, "gSmsRequestManager",
                                   "XXX",
                                   "Ci.nsISmsRequestManagerXXX");
*/

/**
 * Fake implementation of nsISmsService
 */
let gSmsService = (function() {
  return {
    createSmsMessage: function(id,
                               delivery,
                               sender,
                               receiver,
                               body,
                               timestamp) {
      return { "id": id,
               "delivery": delivery,
               "sender": sender,
               "receiver": receiver,
               "body": body,
               "timestamp": timestamp };
    }
  };
})();

/**
 * SmsDatabaseService
 */
function SmsDatabaseService() {
  this._messageLists = Object.create(null);
}
SmsDatabaseService.prototype = {

  /*classID:   SMSDATABASESERVICE_CID,
  classInfo: XPCOMUtils.generateCI({classID: SMSDATABASESERVICE_CID,
                                    classDescription: "SmsDatabaseService",
                                    interfaces: [Ci.nsISmsDatabaseService]}),
  QueryInterface: XPCOMUtils.generateQI([Ci.nsISmsDatabaseService]),*/

  /**
   * Cache the DB here.
   */
  db: null,

  /**
   * DB request queue.
   */
  requestQueue: [],

  /**
   * TODO: just for testing purposes
   */
  cursor: null,

  /**
   * Init method just for HTML testing
   */ 
  init: function init(aWindow) {
    this.window = aWindow;
  },

  /**
   * Prepare the database. This may include opening the database and upgrading
   * it to the latest schema version.
   *
   * @param callback
   *        Function that takes an error and db argument. It is called when
   *        the database is ready to use or if an error occurs while preparing
   *        the database.
   *
   * @return (via callback) a database ready for use.
   */
  ensureDB: function ensureDB(callback) {
    if (this.db) {
      if (DEBUG) debug("ensureDB: already have a database, returning early.");
      callback(null, this.db);
      return;
    }

    let self = this;
    function gotDB(db) {
      self.db = db;
      callback(null, db);
    }
    
    let indexedDB = this.window.mozIndexedDB;
    let request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onsuccess = function (event) {
      if (DEBUG) debug("Opened database:", DB_NAME, DB_VERSION);
      gotDB(event.target.result);
    };
    request.onupgradeneeded = function (event) {
      if (DEBUG) {
        debug("Database needs upgrade:", DB_NAME,
              event.oldVersion, event.newVersion);
        debug("Correct new database version:", event.newVersion == DB_VERSION);
      }

      let db = event.target.result;

      switch (event.oldVersion) {
        case 0:
          if (DEBUG) debug("New database");
          self.createSchema(db);
          break;

        default:
          event.target.transaction.abort();
          callback("Old database version: " + event.oldVersion, null);
          break;
      }
    };
    request.onerror = function (event) {
      //TODO look at event.target.Code and change error constant accordingly
      callback("Error opening database!", null);
    };
    request.onblocked = function (event) {
      callback("Opening database request is blocked.", null);
    };
  },

  /**
   * Start a new transaction.
   *
   * @param txn_type
   *        Type of transaction (e.g. IDBTransaction.READ_WRITE)
   * @param callback
   *        Function to call when the transaction is available. It will
   *        be invoked with the transaction and the 'sms' object store.
   * @param oncompleteCb [optional]
   *        Success callback to call on a successful transaction commit.
   * @param onerrorCb [optional]
   *        Error callback to call when an error is encountered.
   */
  newTxn: function newTxn(txn_type, callback, oncompleteCb, onerrorCb) {
    this.ensureDB(function (error, db) {
      if (error) {
        if (DEBUG) debug("Could not open database: " + error);
        callback(error, null, null);
        return;
      }
      if (DEBUG) debug("Starting new transaction", txn_type);
      let txn = db.transaction([STORE_NAME], txn_type);
      if (DEBUG) debug("Retrieving object store", STORE_NAME);
      let store = txn.objectStore(STORE_NAME);
      txn.oncomplete = oncompleteCb;
      txn.onerror = onerrorCb;
      callback(txn, store);
    });
  },

  /**
   * Create the initial database schema.
   *
   * TODO need to worry about number normalizaton somewhere...
   * TODO full text search on body???
   */
  createSchema: function createSchema(db) {
    let objectStore = db.createObjectStore(STORE_NAME, {keyPath: "id"});
    objectStore.createIndex("id", "id", { unique: true });
    objectStore.createIndex("delivery", "delivery", { unique: false });
    objectStore.createIndex("sender", "sender", { unique: false });
    objectStore.createIndex("receiver", "receiver", { unique: false });
    objectStore.createIndex("timestamp", "timestamp", { unique:false });
    if (DEBUG) debug("Created object stores and indexes");
  },

  // nsISmsDatabaseService

  //TODO this method should not be synchronous (bug 720653)
  saveSentMessage: function saveSentMessage(receiver, body, date) {
    let id = XXX;
    return id;
  },

  saveSentMessageOWD: function saveSentMessage(receiver, body, date, 
                                               successCb, failureCb) {
    let record = gSmsService.createSmsMessage(generateUUID(),
                                              DELIVERY_SENT,
                                              CURRENT_ADDRESS,
                                              receiver,
                                              body,
                                              date);
    this.newTxn(IDBTransaction.READ_WRITE, function(txn, store, error) {
        if (error) {
          failureCb("Transaction error");
        }
        let request = store.put(record);        
        request.onsuccess = function (event) {
          txn.result = record;
        };
      }, function (event) {
        debug("saveSentMessageOWD. result: " + event.target.result);
        successCb(event.target.result);
      }, failureCb);
  },

  //TODO need to save incoming SMS, too!

  getMessage: function getMessage(messageId, requestId) {
    this.newTxn(IDBTransaction.READ_ONLY, function (error, txn, store) {
      let request = store.getAll(messageId);

      txn.oncomplete = function (event) {
        if (DEBUG) debug("Transaction complete, notifying request manager.");

        let data = request.result[0];
        if (!data) {
          gSmsRequestManager.notifyGetSmsFailed(requestId, eNotFoundError);
          return;
        }
        let message = gSmsService.createSmsMessage(data.id,
                                                   data.delivered,
                                                   data.sender,
                                                   data.receiver,
                                                   data.body,
                                                   data.timestamp);
        gSmsRequestManager.notifyGotSms(requestId, message);
      };
      txn.onerror = function (event) {
        if (DEBUG) debug("Caught error on transaction", event.target.errorCode);
        //TODO look at event.target.errorCode, pick appropriate error constant
        gSmsRequestManager.notifyGetSmsFailed(requestId, eInternalError);
      };
    });
  },

  getMessageOWD: function getMessageOWD(messageId, successCb, failureCb) {
    this.newTxn(IDBTransaction.READ_ONLY, function (txn, store, error) {
        let request = store.getAll(messageId);
        request.onsuccess = function (event) {
          debug("Request successfull. Record count: ", 
                event.target.result.length);
          txn.result = event.target.result;
        };
      }, function (event) {
        debug("getMessageOWD. Transaction complete");
        successCb(event.target.result);
      }, failureCb);
  },

  deleteMessage: function deleteMessage(messageId, requestId) {
    this.newTxn(function (txn, store, error) {
      let request = store.delete(messageId);
      txn.oncomplete = function (event) {
        gSmsRequestManager.notifySmsDeleted(requestId, true);
      };
      txn.onerror = function (event) {
        if (DEBUG) debug("Caught error on transaction", event.target.errorCode);
        //TODO look at event.target.errorCode, pick appropriate error constant
        gSmsRequestManager.notifySmsDeleteFailed(requestId, eInternalError);
      };
    });
  },

  deleteMessageOWD: function deleteMessageOWD(messageId, successCb, failureCb) {
    this.newTxn(IDBTransaction.READ_WRITE, function (txn, store, error) {
        let request = store.delete(messageId);        
      }, function (event) {
        debug("deleteMessageOWD. Transaction complete");
        successCb(event.target.result);
      }, failureCb);
  },

//The message list stuff could be elegantly implemented using IDB cursors,
//except we'd need to keep the txn open, so maybe not such a good idea
//(unless we find a way to queue other requests while a list is being
//processed, but that sounds messy).

  createMessageList: function createMessageList(filter, reverse, requestId) {
    //TODO
  },

  getNextMessageInList: function getNextMessageInList(listId, requestId, processId) {
    //TODO
  },

  clearMessageList: function clearMessageList(listId) {
    //TODO
  }

};

//const NSGetFactory = XPCOMUtils.generateNSGetFactory([SmsDatabaseService]);

/**
 * Generate a UUID according to RFC4122 v4 (random UUIDs)
 */
function generateUUID() {
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
};



/**
 * Fake setup for HTML
 */
let smsdb = window.navigator.mozSmsDatabase = new SmsDatabaseService();
smsdb.init(window);

function debug() {
  dump(Array.slice(arguments).join(" ") + "\n");
}
