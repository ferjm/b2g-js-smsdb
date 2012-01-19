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
 *   Mounir Lamouri <mounir.lamouri@mozilla.com> (Original Author)
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

const {classes: Cc, interfaces: Ci, utils: Cu, results: Cr} = Components;

Cu.import("resource://gre/modules/XPCOMUtils.jsm");

const SMS_DATABASE_SERVICE_CID = Components.ID("{b103bf20-4282-11e1-b86c-0800200c9a66}");
const SMS_DATABASE_SERVICE_CONTRACTID = "@mozilla.org/smsdatabaseservice;1";

// TODO: Is this the correct way to create an XPCOM service??
//       https://alexvincent.us/blog/?p=453
var smsDatabaseService = null;

function SmsDatabaseService() {
  if (smsDatabaseService) {
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

  },
};

function NSGetModule(compMgr, fileSpec) {
  return XPCOMUtils.generateModule([SmsDatabaseService]);
}
