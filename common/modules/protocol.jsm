// Copyright (c) 2008-2014 Kris Maglione <maglione.k@gmail.com>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
"use strict";

defineModule("protocol", {
    exports: ["LocaleChannel", "Protocol", "RedirectChannel", "StringChannel", "XMLChannel"],
    require: ["services", "util"]
});

var systemPrincipal = Cc["@mozilla.org/systemprincipal;1"].getService(Ci.nsIPrincipal);

function Channel(url, orig, noErrorChannel, unprivileged) {
    try {
        if (url == null)
            return noErrorChannel ? null : NetError(orig);

        if (url instanceof Ci.nsIChannel)
            return url;

        if (typeof url === "function")
            return let ([type, data] = url(orig)) StringChannel(data, type, orig);

        if (isArray(url))
            return let ([type, data] = url) StringChannel(data, type, orig);

        let uri = services.io.newURI(url, null, null);
        return (new XMLChannel(uri, null, noErrorChannel)).channel;
    }
    catch (e) {
        util.reportError(e);
        util.dump(url);
        throw e;
    }
}
function NetError(orig, error) {
    return services.InterfacePointer({
        QueryInterface: XPCOMUtils.generateQI([Ci.nsIChannel]),

        name: orig.spec,

        URI: orig,

        originalURI: orig,

        asyncOpen: function () { throw error || Cr.NS_ERROR_FILE_NOT_FOUND; },

        open: function () { throw error || Cr.NS_ERROR_FILE_NOT_FOUND; }
    }).data.QueryInterface(Ci.nsIChannel);
}
function RedirectChannel(to, orig, time, message) {
    let html = DOM.toXML(
        ["html", {},
            ["head", {},
                ["meta", { "http-equiv": "Refresh", content: (time || 0) + ";" + to }]],
            ["body", {},
                ["h2", { style: "text-align: center" }, message || ""]]]);
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

        _xpcom_factory: JSMLoader.Factory(Protocol)
    };
    return Protocol;
}

function ProtocolBase() {
    this.wrappedJSObject = this;

    this.pages = {};
    this.providers = {
        "content": function (uri, path) this.pages[path] || this.contentBase + path,

        "data": function (uri) {
            var channel = services.io.newChannel(uri.path.replace(/^\/(.*)(?:#.*)?/, "data:$1"),
                                                 null, null);

            channel.contentCharset = "UTF-8";
            channel.owner = systemPrincipal;
            channel.originalURI = uri;
            return channel;
        }
    };
}
ProtocolBase.prototype = {
    get contractID()        services.PROTOCOL + this.scheme,
    get classDescription()  this.scheme + " utility protocol",
    QueryInterface:         XPCOMUtils.generateQI([Ci.nsIProtocolHandler]),

    purge: function purge() {
        for (let doc in util.iterDocuments())
            try {
                if (doc.documentURIObject.scheme == this.scheme)
                    doc.defaultView.close();
            }
            catch (e) {
                util.reportError(e);
            }
    },

    defaultPort: -1,
    allowPort: function (port, scheme) false,
    protocolFlags: 0
         | Ci.nsIProtocolHandler.URI_IS_UI_RESOURCE
         | Ci.nsIProtocolHandler.URI_IS_LOCAL_RESOURCE,

    newURI: function newURI(spec, charset, baseURI) {
        if (baseURI && (!(baseURI instanceof Ci.nsIURL) || baseURI.host === "data"))
            baseURI = null;
        return services.URL(services.URL.URLTYPE_AUTHORITY,
                            this.defaultPort, spec, charset, baseURI);
    },

    newChannel: function newChannel(uri) {
        try {
            uri.QueryInterface(Ci.nsIURL);

            let path = decodeURIComponent(uri.filePath.substr(1));
            if (uri.host in this.providers)
                return Channel(this.providers[uri.host].call(this, uri, path),
                               uri);

            return NetError(uri);
        }
        catch (e) {
            util.reportError(e);
            throw e;
        }
    }
};

function LocaleChannel(pkg, locale, path, orig) {
    for (let locale of [locale, "en-US"])
        for (let sep of "-/") {
            var channel = Channel(["resource:/", pkg + sep + locale, path].join("/"), orig, true, true);
            if (channel)
                return channel;
        }

    return NetError(orig);
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

function XMLChannel(uri, contentType, noErrorChannel, unprivileged) {
    try {
        var channel = services.io.newChannelFromURI(uri);
        var channelStream = channel.open();
    }
    catch (e) {
        this.channel = noErrorChannel ? null : NetError(uri);
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
    if (!unprivileged)
        this.channel.owner = systemPrincipal;

    let type = this.channel.contentType;
    if (/^text\/|[\/+]xml$/.test(type)) {
        let stream = services.InputStream(channelStream);
        let [, pre, doctype, url, extra, open, post] = util.regexp(literal(function () /*
                ^ ([^]*?)
                (?:
                    (<!DOCTYPE \s+ \S+ \s+) (?:SYSTEM \s+ "([^"]*)" | ((?:[^[>\s]|\s[^[])*))
                    (\s+ \[)?
                    ([^]*)
                )?
                $
            */$), "x").exec(stream.read(4096));
        this.writes.push(pre);
        if (doctype) {
            this.writes.push(doctype + (extra || "") + " [\n");
            if (url)
                this.addChannel(url);

            if (!open)
                this.writes.push("\n]");

            for (let [, pre, url] in util.regexp.iterate(/([^]*?)(?:%include\s+"([^"]*)";|$)/gy, post)) {
                this.writes.push(pre);
                if (url)
                    this.addChannel(url);
            }
        }
    }
    this.writes.push(channelStream);

    this.writeNext();
}
XMLChannel.prototype = {
    QueryInterface:   XPCOMUtils.generateQI([Ci.nsIRequestObserver]),

    addChannel: function addChannel(url) {
        try {
            this.writes.push(services.io.newChannel(url, null, this.uri).open());
        }
        catch (e) {
            util.dump("addChannel('" + url + "'):");
            util.reportError(e);
        }
    },

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

// vim: set fdm=marker sw=4 sts=4 ts=8 et ft=javascript:
