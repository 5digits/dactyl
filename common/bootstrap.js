// https://wiki.mozilla.org/Extension_Manager:Bootstrapped_Extensions

const NAME = "bootstrap";
const global = this;

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cu = Components.utils;
const Cr = Components.results;

Cu.import("resource://gre/modules/AddonManager.jsm");
Cu.import("resource://gre/modules/XPCOMUtils.jsm");

const io = Cc["@mozilla.org/network/io-service;1"].getService(Ci.nsIIOService);
const resourceProto = io.getProtocolHandler("resource")
                        .QueryInterface(Ci.nsIResProtocolHandler);
const categoryManager = Cc["@mozilla.org/categorymanager;1"].getService(Ci.nsICategoryManager);
const manager = Components.manager.QueryInterface(Ci.nsIComponentRegistrar);

function httpGet(url) {
    let xmlhttp = Cc["@mozilla.org/xmlextras/xmlhttprequest;1"].createInstance(Ci.nsIXMLHttpRequest);
    xmlhttp.open("GET", url, false);
    xmlhttp.send(null);
    return xmlhttp;
}

function writeFile(file, buf) {
    let fstream = Cc["@mozilla.org/network/file-output-stream;1"].createInstance(Ci.nsIFileOutputStream);
    let stream = Cc["@mozilla.org/intl/converter-output-stream;1"].createInstance(Ci.nsIConverterOutputStream);

    fstream.init(file, 0x02 | 0x08 | 0x20, parseInt("0644", 8), 0);
    stream.init(fstream, "UTF-8", 0, "?");
    stream.writeString(buf);
    stream.close();
    fstream.close();
}

let initialized = false;
let addon = null;
let basePath = null;

function startup(data, reason) {
    dump("dactyl: bootstrap: startup\n");
    basePath = data.installPath;

    if (!initialized) {
        initialized = true;

        dump("dactyl: bootstrap: init" + " " + data.id + "\n");

        AddonManager.getAddonByID(data.id, function (res) {
            try {
                addon = res;
                init();
            }
            catch (e) {
                dump("dactyl: bootstrap: " + e + "\n");
                Cu.reportError(e);
            }
        });

    }
}

function FactoryProxy(url, classID) {
    this.url = url;
    this.classID = Components.ID(classID);
}
FactoryProxy.prototype = {
    QueryInterface: XPCOMUtils.generateQI(Ci.nsIFactory),
    init: function () {
        manager.registerFactory(this.classID,
                                String(this.classID),
                                this.contractID,
                                this);
    },
    get module() {
        Class.replaceProperty(this, "module", {});
        Cu.import(this.url, this.module);
        return this.module;
    },
    createInstance: function ()
        let (factory = this.module.NSGetFactory(this.classID))
            factory.createInstance.apply(factory, arguments)
}

function init() {
    dump("dactyl: bootstrap: init: " + addon + "\n");

    let manifestURI = addon.getResourceURI("chrome.manifest");
    let manifest = httpGet(manifestURI.spec)
            .responseText
            .replace(/^\s*|\s*$|#.*/g, "")
            .replace(/^\s*\n/gm, "");

    function url(path) addon.getResourceURI(path).spec;

    let result = [];
    let components = {};

    for each (let line in manifest.split("\n")) {
        let fields = line.split(/\s+/);
        switch(fields[0]) {
        case "content":
            fields[2] = url(fields[2]);
        default:
            result.push(fields);
            break;

        case "locale":
        case "skin":
            fields[3] = url(fields[3]);
            result.push(fields);
            break;

        case "category":
            categoryManager.addCategoryEntry(fields[1], fields[2], fields[3], false, true);
            break;
        case "component":
            components[fields[1]] = new FactoryProxy(url(fields[2]), fields[1]);
            break;
        case "contract":
            components[fields[2]].contractID = fields[1];
            components[fields[2]].init();
            break;

        case "resource":
            resourceProto.setSubstitution(fields[1], addon.getResourceURI(fields[2]));
        }
    }

    Cu.import("resource://dactyl/base.jsm");
    require(global, "prefs");
    require(global, "services");

    services.subscriptLoader.loadSubScript(
        url("defaults/preferences/dactyl.js"),
        {
            pref: function pref(name, val) {
                if (prefs.get(name, null) == null)
                    prefs.set(name, val);
            }
        });

    if (manifestURI instanceof Ci.nsIFileURL)
        manager.autoRegister(file.QueryInterface(Ci.nsIFileURL).file);
    else {
        var file = basePath.parent;
        file.append(addon.id + ".manifest");

        writeFile(file, result.map(function (line) line.join(" ")).join("\n"));
        manager.autoRegister(file);
        //file.remove(false);
    }
}

function reasonToString(reason) {
    for each (let name in ["disable", "downgrade", "enable",
                           "install", "shutdown", "startup",
                           "uninstall", "upgrade"])
        if (reason == global["ADDON_" + name.toUpperCase()] ||
            reason == global["APP_" + name.toUpperCase()])
            return name;
}

function install(data, reason) { dump("dactyl: bootstrap: install\n") }
function shutdown(data, reason) { dump("dactyl: bootstrap: shutdown\n") }
function uninstall(data, reason) { dump("dactyl: bootstrap: uninstall\n") }

