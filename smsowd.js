/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

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

/**
 * Fake implementation of nsISmsService
 */
var gSmsService = (function() {
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
var MessagesListManager = (function() {
  // Private member containing the list of IDBCursors associated with each
  // message list.
  var _keys = Object.create(null);

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
      var uuid = generateUUID();
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
    },

   /**
    * Get the next key for a specific message list
    */
    getNextInList: function (uuid) {
      if (_keys[uuid]) {
        return _keys[uuid].shift();
      }
      debug("Trying to get a message from an unknown list!");
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

  /**
   * Cache the DB here.
   */
  db: null,

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

    var self = this;
    function gotDB(db) {
      self.db = db;
      callback(null, db);
    }

    var indexedDB = this.window.mozIndexedDB;
    var request = indexedDB.open(DB_NAME, DB_VERSION);
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

      var db = event.target.result;

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
      var txn = db.transaction([STORE_NAME], txn_type);
      if (DEBUG) debug("Retrieving object store", STORE_NAME);
      var store = txn.objectStore(STORE_NAME);
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
    var objectStore = db.createObjectStore(STORE_NAME, {keyPath: "id"});
    objectStore.createIndex("id", "id", { unique: true });
    objectStore.createIndex("delivery", "delivery", { unique: false });
    objectStore.createIndex("sender", "sender", { unique: false });
    objectStore.createIndex("receiver", "receiver", { unique: false });
    objectStore.createIndex("timestamp", "timestamp", { unique:false });
    if (DEBUG) debug("Created object stores and indexes");
  },

  // nsISmsDatabaseService

  saveMessage: function saveMessage(delivery, 
                                    receiver, 
                                    sender,
                                    body,
                                    date,
                                    successCb,
                                    failureCb) {
    var record = gSmsService.createSmsMessage(generateUUID(),
                                              delivery,
                                              sender,
                                              receiver,
                                              body,
                                              date);
    this.newTxn(IDBTransaction.READ_WRITE, function(txn, store, error) {
        if (error) {
          failureCb("Transaction error");
        }
        var request = store.put(record);
        request.onsuccess = function (event) {
          txn.result = record;
        };
      }, function (event) {
        if (DEBUG) debug("saveSentMessageOWD. result: " + event.target.result);
        successCb(event.target.result);
      }, failureCb);

  },

  saveSentMessage: function saveSentMessage(receiver, body, date,
                                            successCb, failureCb) {
    this.saveMessage(DELIVERY_SENT,
                     CURRENT_ADDRESS,
                     receiver,
                     body,
                     date,
                     successCb,
                     failureCb);
  },

  saveReceivedMessage: function saveReceivedMessage(sender, body, date,
                                                    successCb, failureCb) {
    this.saveMessage(DELIVERY_RECEIVED,
                     sender,
                     CURRENT_ADDRESS,
                     body,
                     dates,
                     successCb,
                     failureCb);
  },

  //TODO need to save incoming SMS, too!
  getMessage: function getMessage(messageId, successCb, failureCb) {
    this.newTxn(IDBTransaction.READ_ONLY, function (txn, store, error) {
        var request = store.getAll(messageId);
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

  getAllMessages: function getAllMessages(successCb, failureCb) {
    this.newTxn(IDBTransaction.READ_ONLY, function (txn, store, error) {
        var request = store.getAll();
        request.onsuccess = function (event) {
          if (DEBUG) debug("Request successfull. Record count: ", 
            event.target.result.length);
          txn.result = event.target.result;
        };
      }, function (event) {
        if (DEBUG) debug("getAllMessages. Transaction complete");
        successCb(event.target.result);
      }, failureCb);
  },

  deleteMessage: function deleteMessage(messageId, successCb, failureCb) {
    this.newTxn(IDBTransaction.READ_WRITE, function (txn, store, error) {
        var request = store.delete(messageId);
      }, function (event) {
        if (DEBUG) debug("deleteMessageOWD. Transaction complete");
        successCb(event.target.result);
      }, failureCb);
  },

//The message list stuff could be elegantly implemented using IDB cursors,
//except we'd need to keep the txn open, so maybe not such a good idea
//(unless we find a way to queue other requests while a list is being
//processed, but that sounds messy).

  createMessageList: function createMessageList(filter, reverse, requestId,
                                                successCb, failureCb) {
    // This object keeps a list of the keys that matches the search criteria
    // according to the nsIMozSmsFilter parameter.
    // Its final content will be the intersection of the results of all the
    // cursor requests that matches each of the filter parameters.
    // TODO not sure if this is the best approach for storing the keys...
    //      An object make the insertion O(1), but the retrieval of keys
    //      would be unsorted. An array has an extra cost of post-insertion as
    //      we need to delete duplicate keys, but it has O(1) cost for key
    //      obtention and it is definitely sorted.
    var filteredKeys = [];
    // We need to apply the searches according to all the parameters of the
    // filter. filterCount will decrease with each of this searches.
    var filterCount = 4;

    var onsuccess = function (event) {
      var result = event.target.result;
      // Once the cursor has retrieved all keys that matches its key range,
      // the filter search is done and filterCount is decreased.
      if (!!result == false) {
        debug("filterCount: " + filterCount);
        filterCount--;
        return;
      }
      // The cursor primaryKey is stored in filteredKeys.
      var primaryKey = result.primaryKey;
      if (DEBUG) debug("Data: " + result.primaryKey);
      filteredKeys.push(primaryKey);
      result.continue();
    };

    var onerror = function (event) {
      if (DEBUG) debug("Error retrieving cursor.");
      failureCb(event.target);
      return;
    };

    // As we need to get the list of keys that match the filter criteria
    // sorted by timestamp index, we will split the key obtention in two
    // different transactions. One for the timestamp index and another one
    // for the rest of indexes to query.
    var self = this;
    this.newTxn(IDBTransaction.READ_ONLY,function (txn, store, error) {
      if (error) {
        failureCb(error);
        return;
      }
      // In first place, we retrieve the keys that match the filter.startDate
      // and filter.endDate search criteria.
      if (!filter.startDate && !filter.endDate) {
        return;
      }
      var timeKeyRange = IDBKeyRange.bound(filter.startDate, filter.endDate);
      var timeRequest;
      if (reverse == true) {
        timeRequest = store.index("timestamp").openKeyCursor(timeKeyRange,
                                                             IDBCursor.PREV);
      } else {
        timeRequest = store.index("timestamp").openKeyCursor(timeKeyRange);
      }

      timeRequest.onsuccess = onsuccess;
      timeRequest.onerror = onerror;
    }, function (event) {
      // The rest of searches will happen within the same transaction
      self.newTxn(IDBTransaction.READ_ONLY, function (txn, store, error) {
        if (error) {
          failureCb(error);
          return;
        }

        if (filter.delivery) {
          // Retrieve the keys from the 'delivery' index that matches the value of
          // filter.delivery.
          var deliveryKeyRange = IDBKeyRange.only(filter.delivery);
          var deliveryRequest = store.index("delivery").openKeyCursor(deliveryKeyRange);
          deliveryRequest.onsuccess = onsuccess;
          deliveryRequest.onerror = onerror;
        } else {
          filterCount--;
        }

        if (filter.numbers) {
          // Retrieve the keys from the 'sender' and 'receiver' indexes that match
          // the values of filter.numbers
          var numberKeyRange = IDBKeyRange.bound(filter.numbers[0],
                                                 filter.numbers[filter.numbers.length-1]);
          var senderRequest = store.index("sender").openKeyCursor(numberKeyRange);
          var receiverRequest = store.index("receiver").openKeyCursor(numberKeyRange);
          senderRequest.onsuccess = receiverRequest.onsuccess = onsuccess;
          senderRequest.onerror = receiverRequest.onerror = onerror;
        } else {
          filterCount--;
        }
      }, function (event) {
        if (filterCount == 0) {
          if (filteredKeys.length == 0) {
            failureCb("0 retrieved");
            return;
          }
          // We need to get rid off the duplicated keys.
          var result = [];
          for (var i = 0; i < filteredKeys.length; i++ ) {
            if ( result.indexOf( filteredKeys[i], 0, filteredKeys ) < 0 ) {
              result.push(filteredKeys[i]);
            }
          }
          // At this point, filteredKeys should have all the keys that matches
          // all the search filters. So we take the first key in another txn
          // and retrieve the corresponding message. The rest of the keys are
          // added to the MessagesListManager, which assigns it a message list
          // identifier.
          var message;
          self.newTxn(IDBTransaction.READ_ONLY, function (txn, store, error) {
            //TODO Do we want to keep the list of keys?
            var messageId = result.shift();
            var request = store.get(messageId);
            request.onsuccess = function (event) {
              if (DEBUG) debug("Message successfully retrieved");
              txn.result = event.target.result;
              return;
            };
            request.onerror = function (event) {
              failureCb();
            };
          }, function (event) {
            var messageListId = MessagesListManager.add(filteredKeys);
            var message = event.target.result;
            successCb(messageListId, message);
            return;
          }, failureCb);
        } else {
          failureCb("There are filters left to apply");
        }
      }, failureCb);
    }, failureCb);
  },

  getNextMessageInList: function getNextMessageInList(listId,
                                                      successCb,
                                                      failureCb) {
    var key = MessagesListManager.getNextInList(listId);
    if (key == null) {
      failureCb();
      return;
    }
    if (key) {
      this.newTxn(IDBTransaction.READ_ONLY, function (txn, store, error) {
        var request = store.get(key);
        request.onsuccess = function (event) {
          var data = request.result;
          if (data) {
            txn.result = data;
            return;
          }
          failureCb("Could not retrieve sms");
        };
        request.onerror = failureCb;
      }, function (event) {
        successCb(event.target.result);
      }, failureCb);
    }
  },

  clearMessageList: function clearMessageList(listId) {
    MessagesListManager.remove(listId);
    successCb();
  }

};

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
 * Wrapper for the fake implementation of mozSmsManager (nsIDOMMozNavigatorSms)
 */
function SmsManager() {
  var mozSms = window.navigator.mozSms;
}
SmsManager.prototype = {
  getNumberOfMessagesForText: function getNumberOfMessagesForText(text) {
    return mozSms.getNumberOfMessagesForText();
  },

  send: function send(number, message, successCb, failureCb) {
    var request = mozSms.send(number, message);
    request.onsuccess = function (event) {
      var data = event.target.result;
      if (data) {
        smsdb.saveSentMessage(data.receiver,
                              data.body,
                              data.timestamp,
                              successCb,
                              failureCb);
        return;
      }
      failureCb("mozSms.send: No data");
    };
    request.onerror = function (event) {
      failureCb(event);
    };
  },

  getMessage: function getMessage(id, successCb, failureCb) {
    smsdb.getMessage(id, successCb, failureCb);
  },

  delete: function deleteMessage(id, successCb, failureCb) {
    smsdb.deleteMessage(id, successCb, failureCb);
  },

  getMessages: function getMessages(filter, reverse, successCb, failureCb) {
    if (filter && 
        (filter.hasOwnProperty("delivered") ||
         filter.hasOwnProperty("starDate") || 
         filter.hasOwnProperty("endDate") ||
         filter.hasOwnProperty("numbers"))) {
      //TODO
    } else {
      smsdb.getAllMessages(successCb, failureCb);
    }
  },  
};



/**
 * Fake setup for HTML
 */
var smsdb = window.navigator.mozSmsDatabase = new SmsDatabaseService();
smsdb.init(window);

var owdSms = new SmsManager();

/*function debug() {
  dump(Array.slice(arguments).join(" ") + "\n");
}*/

function debug() {
  var args = Array.slice(arguments);
  args.unshift("DEBUG");
  console.log.apply(console, args);
}
