// Copyright (c) 2008-2010 Kris Maglione <maglione.k at Gmail>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
"use strict";

/* Adds support for data: URIs with chrome privileges
 * and fragment identifiers.
 *
 * "chrome-data:" <content-type> [; <flag>]* "," [<data>]
 *
 * By Kris Maglione, ideas from Ed Anuff's nsChromeExtensionHandler.
 */

const Ci = Components.interfaces, Cc = Components.classes;

Components.utils.import("resource://gre/modules/XPCOMUtils.jsm");

const NS_BINDING_ABORTED = 0x804b0002;
const nsIProtocolHandler = Components.interfaces.nsIProtocolHandler;

const ioService = Cc["@mozilla.org/network/io-service;1"].getService(Ci.nsIIOService);
const prefs = Cc["@mozilla.org/preferences-service;1"].getService(Ci.nsIPrefService)
    .getBranch("extensions.dactyl.");
const systemPrincipal = Cc["@mozilla.org/systemprincipal;1"].getService(Ci.nsIPrincipal);

function dataURL(type, data) "data:" + (type || "application/xml;encoding=UTF-8") + "," + escape(data);
function makeChannel(url, orig) {
    if (url == null)
        return fakeChannel();
    if (typeof url == "function")
        url = dataURL.apply(null, url());
    let uri = ioService.newURI(url, null, null);
    let channel = ioService.newChannelFromURI(uri);
    channel.contentCharset = "UTF-8";
    channel.owner = systemPrincipal;
    channel.originalURI = orig;
    return channel;
}
function fakeChannel(orig) makeChannel("chrome://dactyl/content/does/not/exist", orig);
function redirect(to, orig, time) {
    let html = <html><head><meta http-equiv="Refresh" content={(time || 0) + ";" + to}/></head></html>.toXMLString();
    return makeChannel(dataURL('text/html', html), ioService.newURI(to, null, null));
}

function ChromeData() {}
ChromeData.prototype = {
    contractID:       "@mozilla.org/network/protocol;1?name=chrome-data",
    classID:          Components.ID("{c1b67a07-18f7-4e13-b361-2edcc35a5a0d}"),
    classDescription: "Data URIs with chrome privileges",
    QueryInterface:   XPCOMUtils.generateQI([Components.interfaces.nsIProtocolHandler]),
    _xpcom_factory: {
        createInstance: function (outer, iid) {
            if (outer != null)
                throw Components.results.NS_ERROR_NO_AGGREGATION;
            if (!ChromeData.instance)
                ChromeData.instance = new ChromeData();
            return ChromeData.instance.QueryInterface(iid);
        }
    },

    scheme: "chrome-data",
    defaultPort: -1,
    allowPort: function (port, scheme) false,
    protocolFlags: nsIProtocolHandler.URI_NORELATIVE
         | nsIProtocolHandler.URI_NOAUTH
         | nsIProtocolHandler.URI_IS_UI_RESOURCE,

    newURI: function (spec, charset, baseURI) {
        var uri = Components.classes["@mozilla.org/network/standard-url;1"]
                            .createInstance(Components.interfaces.nsIStandardURL)
                            .QueryInterface(Components.interfaces.nsIURI);
        uri.init(uri.URLTYPE_STANDARD, this.defaultPort, spec, charset, null);
        return uri;
    },

    newChannel: function (uri) {
        try {
            if (uri.scheme == this.scheme)
                return makeChannel(uri.spec.replace(/^.*?:\/*(.*)(?:#.*)?/, "data:$1"), uri);
        }
        catch (e) {}
        return fakeChannel();
    }
};

function Dactyl() {
    const self = this;
    this.wrappedJSObject = this;

    this.HELP_TAGS = {};
    this.FILE_MAP = {};
    this.OVERLAY_MAP = {};
    this.addonID = this.name + "@dactyl.googlecode.com";

    this.pages = {};
}
Dactyl.prototype = {
    contractID:       "@mozilla.org/network/protocol;1?name=dactyl",
    classID:          Components.ID("{9c8f2530-51c8-4d41-b356-319e0b155c44}"),
    classDescription: "Dactyl utility protocol",
    QueryInterface:   XPCOMUtils.generateQI([Components.interfaces.nsIProtocolHandler]),
    _xpcom_factory: {
        createInstance: function (outer, iid) {
            if (outer != null)
                throw Components.results.NS_ERROR_NO_AGGREGATION;
            if (!Dactyl.instance)
                Dactyl.instance = new Dactyl();
            return Dactyl.instance.QueryInterface(iid);
        }
    },

    appName: prefs.getComplexValue("appName", Ci.nsISupportsString).data,
    fileExt: prefs.getComplexValue("fileExt", Ci.nsISupportsString).data,
    host: prefs.getComplexValue("host", Ci.nsISupportsString).data,
    hostbin: prefs.getComplexValue("hostbin", Ci.nsISupportsString).data,
    idName: prefs.getComplexValue("idName", Ci.nsISupportsString).data,
    name: prefs.getComplexValue("name", Ci.nsISupportsString).data,
    get version() prefs.getComplexValue("version", Ci.nsISupportsString).data,

    init: function (obj) {
        for each (let prop in ["HELP_TAGS", "FILE_MAP", "OVERLAY_MAP"]) {
            this[prop] = this[prop].constructor();
            for (let [k, v] in Iterator(obj[prop] || {}))
                this[prop][k] = v;
        }
    },

    scheme: "dactyl",
    defaultPort: -1,
    allowPort: function (port, scheme) false,
    protocolFlags: 0
         | nsIProtocolHandler.URI_IS_UI_RESOURCE
         | nsIProtocolHandler.URI_IS_LOCAL_RESOURCE,

    newURI: function (spec, charset, baseURI) {
        var uri = Cc["@mozilla.org/network/standard-url;1"]
                        .createInstance(Ci.nsIStandardURL)
                        .QueryInterface(Ci.nsIURI);
        uri.init(uri.URLTYPE_STANDARD, this.defaultPort, spec, charset, baseURI);
        return uri;
    },

    newChannel: function (uri) {
        try {
            if (uri.host != "content" && !("all" in this.FILE_MAP))
                return redirect(uri.spec, uri, 1);

            let path = decodeURIComponent(uri.path.replace(/^\/|#.*/g, ""));
            switch(uri.host) {
            case "content":
                return makeChannel(this.pages[path], uri);
            case "help":
                return makeChannel(this.FILE_MAP[path], uri);
            case "help-overlay":
                return makeChannel(this.OVERLAY_MAP[path], uri);
            case "help-tag":
                let tag = decodeURIComponent(uri.path.substr(1));
                if (tag in this.FILE_MAP)
                    return redirect("dactyl://help/" + tag, uri);
                if (tag in this.HELP_TAGS)
                    return redirect("dactyl://help/" + this.HELP_TAGS[tag] + "#" + tag, uri);
            }
        }
        catch (e) {}
        return fakeChannel(uri);
    }
};

function AboutHandler() {}
AboutHandler.prototype = {

    classDescription: "About " + Dactyl.prototype.appName + " Page",

    classID: Components.ID("81495d80-89ee-4c36-a88d-ea7c4e5ac63f"),

    contractID: "@mozilla.org/network/protocol/about;1?what=" + Dactyl.prototype.name,

    QueryInterface: XPCOMUtils.generateQI([Ci.nsIAboutModule]),

    newChannel: function (uri) {
        let channel = Cc["@mozilla.org/network/io-service;1"].getService(Ci.nsIIOService)
                          .newChannel("chrome://dactyl/content/about.xul", null, null);
        channel.originalURI = uri;
        return channel;
    },

    getURIFlags: function (uri) Ci.nsIAboutModule.ALLOW_SCRIPT,
};

// A hack to get information about interfaces.
// Doesn't belong here.
function Shim() {}
Shim.prototype = {
    contractID:       "@dactyl.googlecode.com/base/xpc-interface-shim",
    classID:          Components.ID("{f4506a17-5b4d-4cd9-92d4-2eb4630dc388}"),
    classDescription: "XPCOM empty interface shim",
    QueryInterface:   function (iid) {
        if (iid.equals(Ci.nsISecurityCheckedComponent))
            throw Components.results.NS_ERROR_NO_INTERFACE;
        return this
    },
    getHelperForLanguage: function () null,
    getInterfaces: function (count) {
        count.value = 0;
    }
};

if (XPCOMUtils.generateNSGetFactory)
    const NSGetFactory = XPCOMUtils.generateNSGetFactory([AboutHandler, ChromeData, Dactyl, Shim]);
else
    const NSGetModule = XPCOMUtils.generateNSGetModule([AboutHandler, ChromeData, Dactyl, Shim]);

// vim: set fdm=marker sw=4 ts=4 et:
