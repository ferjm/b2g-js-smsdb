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
 * MessagesListManager
 *
 * This object keeps a list of IDBKey arrays to iterate over messages lists
 * and provides the functions to manage the insertion and deletion of arrays
 */
let MessagesListManager = (function() {
  // Private member containing the list of IDBCursors associated with each
  // message list.
  let _keys = Object.create(null);

  // Public methods for managing the message lists.
  return {
    /**
     * Add a list to the manager.
     *
     * @param keys[]
     *        Object containing a list of IDBKeys as Object properties.
     *
     * @return the id of the list.
     */
    add: function(keys) {
      // Generate the message list uuid.
      // TODO: use mz uuid generator component.
      let uuid = generateUUID();
      // Insert the keys associated with the message list id.
      _keys[uuid] = keys;
      return uuid;
    },

    /**
     * Get an array of keys for traversing or iterating over a message list
     *
     * @param uuid
     *        Number representing the id of the message list to retrieve
     *
     * @return Array of keys
     */
    get: function(uuid) {
      //TODO: check id as valid uuid. Not sure if mz has a function for that.
      if (_keys[uuid]) {
        return _keys[uuid];
      }
      debug("Trying to get an unknown list!");
      return null;
    },

   /**
    * Remove a message list according to the passed id
    *
    * @param id
    *        Number representing the id of the message list to remove
    */
    remove: function(uuid) {
      delete _keys[uuid];
    },

   /**
    * Remove all message lists in the manager
    */
    clear: function() {
      _keys = {};
    }
  }
})();


/**
 * SmsDatabaseService
 */
function SmsDatabaseService() {
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
        if (DEBUG) debug("saveSentMessageOWD. result: " + event.target.result);
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
          if (DEBUG) debug("Request successfull. Record count: ",
                event.target.result.length);
          txn.result = event.target.result;
        };
      }, function (event) {
        if (DEBUG) debug("getMessageOWD. Transaction complete");
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
        if (DEBUG) debug("deleteMessageOWD. Transaction complete");
        successCb(event.target.result);
      }, failureCb);
  },

//The message list stuff could be elegantly implemented using IDB cursors,
//except we'd need to keep the txn open, so maybe not such a good idea
//(unless we find a way to queue other requests while a list is being
//processed, but that sounds messy).

  createMessageListOWD: function createMessageListOWD(filter, reverse, requestId,
                                                      successCb, failureCb) {
    // This object keeps a list of the keys that matches the search criteria
    // according to the nsIMozSmsFilter parameter.
    // Its final content will be the intersection of the results of all the
    // cursor requests that matches each of the filter parameters.
    // TODO not sure if this is the best approach for storing the keys...
    //      An object make the insertion O(1), but the retrieval of keys
    //      would be unsorted. An array has an extra cost of insertion as we
    //      need to delete duplicate keys, but it has O(1) cost for key
    //      obtention and it is sorted.
    let filteredKeys = {};
    // We need to apply the searches according to all the parameters of the
    // filter. filterCount will decrease with each of this searches.
    let filterCount = 4;

    // As we need to get the list of keys that match the filter criteria
    // sorted by timestamp index, we will split the key obtention in two
    // different transactions. One for the timestamp index and another one
    // for the rest of indexes to query.
    let self = this;
    this.newTxn(IDBTransaction.READ_ONLY,function (txn, store, error) {
      if (error) {
        failureCb("Transaction error.");
        return;
      }
      // In first place, we retrieve the keys that match the filter.startDate
      // and filter.endDate search criteria.
      if (!filter.startDate && !filter.endDate) {
        return;
      }
      let timeKeyRange = IDBKeyRange.bound(filter.startDate, filter.endDate);
      let timeRequest;
      if (reverse == true) {
        timeRequest = store.index("timestamp").openKeyCursor(timeKeyRange,
                                                             IDBCursor.PREV);
      } else {
        timeRequest = store.index("timestamp").openKeyCursor(timeKeyRange); 
      }

      timeRequest.onsuccess = function (event) {
        let result = event.target.result;
        // Once the cursor has retrieved all keys that matches its key range,
        // the filter search is done and filterCount is decreased.
        if (!!result == false) {
          debug("timeRequest filterCount: " + filterCount);
          filterCount--;
          return;
        }
        // The cursor primaryKey is stored in filteredKeys.
        let primaryKey = result.primaryKey;
        if (DEBUG) debug("Data: " + result.primaryKey);
        filteredKeys[primaryKey] = undefined;
        result.continue();
      };

      timeRequest.onerror = function (event) {

      };
    }, function (event) {
      // The rest of searches will happen within the same transaction
      self.newTxn(IDBTransaction.READ_ONLY, function (txn, store, error) {
        if (error) {
          failureCb("Transaction error.");
          return;
        }
        // Retrieve the keys from the 'delivery' index that matches the value of
        // filter.delivery.
        let deliveryKeyRange = IDBKeyRange.only(filter.delivery);
        let deliveryRequest = store.index("delivery").openKeyCursor(deliveryKeyRange);

        // Retrieve the keys from the 'sender' and 'receiver' indexes that match
        // the values of filter.numbers
        let numberKeyRange = IDBKeyRange.bound(filter.numbers[0],
                                               filter.numbers[filter.numbers.length-1]);
        let senderRequest = store.index("sender").openKeyCursor(numberKeyRange);
        let receiverRequest = store.index("receiver").openKeyCursor(numberKeyRange);

        deliveryRequest.onsuccess =
        senderRequest.onsuccess =
        receiverRequest.onsuccess = function (event) {
          let result = event.target.result;
          // Once the cursor has retrieved all keys that matches its key range,
          // the filter search is done and filterCount is decreased.
          if (!!result == false) {
            debug("filterCount: " + filterCount);
            filterCount--;
            return;
          }
          // The cursor primaryKey is stored in filteredKeys.
          let primaryKey = result.primaryKey;
          if (DEBUG) debug("Data: " + result.primaryKey);
          filteredKeys[primaryKey] = undefined;
          result.continue();
        };

        deliveryRequest.onerror =
        senderRequest.onerror =
        receiverRequest.onerror = function (event) {
          if (DEBUG) debug("Error retrieving cursor.");
          failureCb();
        };
      }, function (event) {
        if (filterCount == 0) {
          // At this point, filteredKeys should have all the keys that matches
          // all the search filters. So it is added to the MessagesListManager,
          // which assigns it and returns a message list identifier.
          let messageListId = MessagesListManager.add(filteredKeys);
          successCb(messageListId);
          return;
        }
        failureCb();
      }, failureCb);
    }, failureCb);
  },

  getNextMessageInListOWD: function getNextMessageInListOWD(listId,
                                                            requestId,
                                                            processId) {
      
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

/*function debug() {
  dump(Array.slice(arguments).join(" ") + "\n");
}*/

function debug() {
  let args = Array.slice(arguments);
  args.unshift("DEBUG");
  console.log.apply(console, args);
}
