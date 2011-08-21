// Copyright (c) 2008-2011 by Kris Maglione <maglione.k@gmail.com>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
"use strict";

Components.utils.import("resource://dactyl/bootstrap.jsm");
defineModule("protocol", {
    exports: ["LocaleChannel", "Protocol", "RedirectChannel", "StringChannel", "XMLChannel"],
    require: ["services", "util"]
}, this);

var systemPrincipal = Cc["@mozilla.org/systemprincipal;1"].getService(Ci.nsIPrincipal);

var DNE = "resource://gre/does/not/exist";

function Channel(url, orig, noFake) {
    try {
        if (url == null)
            return noFake ? null : FakeChannel(orig);

        if (url instanceof Ci.nsIChannel)
            return url;

        if (typeof url === "function")
            return let ([type, data] = url(orig)) StringChannel(data, type, orig);

        if (isArray(url))
            return let ([type, data] = url) StringChannel(data, type, orig);

        let uri = services.io.newURI(url, null, null);
        return (new XMLChannel(uri, null, noFake)).channel;
    }
    catch (e) {
        util.reportError(e);
        throw e;
    }
}
function FakeChannel(orig) {
    let channel = services.io.newChannel(DNE, null, null);
    channel.originalURI = orig;
    return channel;
}
function RedirectChannel(to, orig, time) {
    let html = <html><head><meta http-equiv="Refresh" content={(time || 0) + ";" + to}/></head></html>.toXMLString();
    return StringChannel(html, "text/html", services.io.newURI(to, null, null));
}

function Protocol(scheme, classID, contentBase) {
    function Protocol() {
        ProtocolBase.call(this);
    }
    Protocol.prototype = {
        __proto__: ProtocolBase.prototype,

        classID: Components.ID(classID),

        scheme: scheme,

        contentBase: contentBase,

        _xpcom_factory: JSMLoader.Factory(Protocol),
    };
    return Protocol;
}

function ProtocolBase() {
    this.wrappedJSObject = this;

    this.pages = {};
    this.providers = {};
}
ProtocolBase.prototype = {
    get contractID()        "@mozilla.org/network/protocol;1?name=" + this.scheme,
    get classDescription()  this.scheme + " utility protocol",
    QueryInterface:         XPCOMUtils.generateQI([Ci.nsIProtocolHandler]),

    defaultPort: -1,
    allowPort: function (port, scheme) false,
    protocolFlags: 0
         | Ci.nsIProtocolHandler.URI_IS_UI_RESOURCE
         | Ci.nsIProtocolHandler.URI_IS_LOCAL_RESOURCE,

    newURI: function newURI(spec, charset, baseURI) {
        if (baseURI && baseURI.host === "data")
            baseURI = null;
        return services.URL(services.URL.URLTYPE_AUTHORITY,
                            this.defaultPort, spec, charset, baseURI);
    },

    newChannel: function newChannel(uri) {
        try {
            uri.QueryInterface(Ci.nsIURL);

            if (uri.host in this.providers)
                return Channel(this.providers[uri.host](uri, uri.filePath.substr(1)), uri);

            let path = decodeURIComponent(uri.path.replace(/^\/|#.*/g, ""));
            switch(uri.host) {
            case "content":
                return Channel(this.pages[path] || this.contentBase + path, uri);
            case "data":
                try {
                    var channel = services.io.newChannel(uri.path.replace(/^\/(.*)(?:#.*)?/, "data:$1"),
                                                       null, null);
                }
                catch (e) {
                    var error = e;
                    break;
                }
                channel.contentCharset = "UTF-8";
                channel.owner = systemPrincipal;
                channel.originalURI = uri;
                return channel;
            }
        }
        catch (e) {
            util.reportError(e);
        }
        if (error)
            throw error;
        return FakeChannel(uri);
    }
};

function LocaleChannel(pkg, locale, path, orig) {
    for each (let locale in [locale, "en-US"])
        for each (let sep in "-/") {
            var channel = Channel(["resource:/", pkg + sep + locale, path].join("/"), orig, true);
            if (channel)
                return channel;
        }

    return FakeChannel(orig);
}

function StringChannel(data, contentType, uri) {
    let channel = services.StreamChannel(uri);
    channel.contentStream = services.CharsetConv("UTF-8").convertToInputStream(data);
    if (contentType)
        channel.contentType = contentType;
    channel.contentCharset = "UTF-8";
    channel.owner = systemPrincipal;
    if (uri)
        channel.originalURI = uri;
    return channel;
}

function XMLChannel(uri, contentType, noFake) {
    try {
        var channel = services.io.newChannelFromURI(uri);
        var channelStream = channel.open();
    }
    catch (e) {
        this.channel = noFake ? null : FakeChannel(uri);
        return;
    }

    this.uri = uri;
    this.sourceChannel = services.io.newChannelFromURI(uri);
    this.pipe = services.Pipe(true, true, 0, 0, null);
    this.writes = [];

    this.channel = services.StreamChannel(uri);
    this.channel.contentStream = this.pipe.inputStream;
    this.channel.contentType = contentType || channel.contentType;
    this.channel.contentCharset = "UTF-8";
    this.channel.owner = systemPrincipal;

    let stream = services.InputStream(channelStream);
    let [, pre, doctype, url, open, post] = util.regexp(<![CDATA[
            ^ ([^]*?)
            (?:
                (<!DOCTYPE \s+ \S+ \s+) SYSTEM \s+ "([^"]*)"
                (\s+ \[)?
                ([^]*)
            )?
            $
        ]]>, "x").exec(stream.read(4096));
    this.writes.push(pre);
    if (doctype) {
        this.writes.push(doctype + "[\n");
        try {
            this.writes.push(services.io.newChannel(url, null, null).open());
        }
        catch (e) {}
        if (!open)
            this.writes.push("\n]");
        this.writes.push(post);
    }
    this.writes.push(channelStream);

    this.writeNext();
}
XMLChannel.prototype = {
    QueryInterface:   XPCOMUtils.generateQI([Ci.nsIRequestObserver]),
    writeNext: function () {
        try {
            if (!this.writes.length)
                this.pipe.outputStream.close();
            else {
                let stream = this.writes.shift();
                if (isString(stream))
                    stream = services.StringStream(stream);

                services.StreamCopier(stream, this.pipe.outputStream, null,
                                      false, true, 4096, true, false)
                        .asyncCopy(this, null);
            }
        }
        catch (e) {
            util.reportError(e);
        }
    },

    onStartRequest: function (request, context) {},
    onStopRequest: function (request, context, statusCode) {
        this.writeNext();
    }
};

endModule();

// vim: set fdm=marker sw=4 ts=4 et:
