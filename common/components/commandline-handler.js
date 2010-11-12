// Copyright (c) 2009 by Doug Kearns
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
"use strict";

const Ci = Components.interfaces, Cc = Components.classes;

Components.utils.import("resource://gre/modules/XPCOMUtils.jsm");

const prefs = Cc["@mozilla.org/preferences-service;1"].getService(Ci.nsIPrefService)
    .getBranch("extensions.dactyl.");
const appName = prefs.getComplexValue("appName", Ci.nsISupportsString).data;
const name = prefs.getComplexValue("name", Ci.nsISupportsString).data;

function CommandLineHandler() {
    this.wrappedJSObject = this;
}
CommandLineHandler.prototype = {

    classDescription: appName + " Command-line Handler",

    classID: Components.ID("{16dc34f7-6d22-4aa4-a67f-2921fb5dcb69}"),

    contractID: "@mozilla.org/commandlinehandler/general-startup;1?type=" + name,

    _xpcom_categories: [{
        category: "command-line-handler",
        entry: "m-" + name
    }],

    QueryInterface: XPCOMUtils.generateQI([Components.interfaces.nsICommandLineHandler]),

    handle: function (commandLine) {
        // TODO: handle remote launches differently?
        try {
            this.optionValue = commandLine.handleFlagWithParam(name, false);
        }
        catch (e) {
            dump(name + ": option '-" + name + "' requires an argument\n");
        }
    },

    helpInfo: "  -" + name + " <opts>" + "             Additional options for " + appName + " startup\n".substr(name.length)
};

if (XPCOMUtils.generateNSGetFactory)
    const NSGetFactory = XPCOMUtils.generateNSGetFactory([CommandLineHandler]);
else
    const NSGetModule = XPCOMUtils.generateNSGetModule([CommandLineHandler]);

// vim: set fdm=marker sw=4 ts=4 et:
