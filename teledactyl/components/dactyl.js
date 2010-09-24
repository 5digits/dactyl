// Copyright (c) 2008-2010 Kris Maglione <maglione.k at Gmail>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
"use strict";

const Ci = Components.interfaces, Cc = Components.classes;

Components.utils.import("resource://gre/modules/XPCOMUtils.jsm");

function Dactyl() {
    this.wrappedJSObject = this;
}
Dactyl.prototype = {
    contractID:       "@dactyl.googlecode.com/base/dactyl",
    classID:          Components.ID("{8e4a8e2f-95a0-4d8f-90ac-fc9d7d8f5468}"),

    classDescription: "Dactyl component base definitions",
    QueryInterface:   XPCOMUtils.generateQI([]),

    appName: "Teledactyl",
    name: "teledactyl",
    idName: "TELEDACTYL",
    host: "Thunderbird"
};

if (XPCOMUtils.generateNSGetFactory)
    const NSGetFactory = XPCOMUtils.generateNSGetFactory([Dactyl]);
else
    const NSGetModule = XPCOMUtils.generateNSGetModule([Dactyl]);

// vim: set fdm=marker sw=4 ts=4 et:
