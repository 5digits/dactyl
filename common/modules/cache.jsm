// Copyright (c) 2011 by Kris Maglione <maglione.k@gmail.com>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
"use strict";

Components.utils.import("resource://dactyl/bootstrap.jsm");
defineModule("cache", {
    exports: ["Cache", "cache"],
    require: ["config", "services", "util"]
}, this);

var Cache = Module("Cache", XPCOM(Ci.nsIRequestObserver), {
    init: function init() {
        this.queue = [];
        this.cache = {};
        this.providers = {};
        this.localProviders = {};

        if (JSMLoader.cacheFlush)
            this.flush();

        update(services["dactyl:"].providers, {
            "cache": function (uri, path) {
                // TODO: Return zip reader stream

                let result = cache.force(path);
                if (isArray(result))
                    return result;

                try {
                    return [services.mime.getTypeFromURI(uri), result];
                }
                catch (e) {
                    return ["text/plain", result];
                }
            }
        });
    },

    Local: function Local(dactyl, modules, window) ({
        init: function init() {
            delete this.instance;
            this.providers = {};
        },

        isLocal: true
    }),

    compression: 9,

    cacheFile: Class.Memoize(function () {
        let dir = File(services.directory.get("ProfD", Ci.nsIFile))
                    .child("dactyl");
        if (!dir.exists())
            dir.create(dir.DIRECTORY_TYPE, octal(777));
        return dir.child("cache.zip");
    }),

    get cacheReader() {
        if (!this._cacheReader && this.cacheFile.exists()
                && !this.inQueue)
            try {
                this._cacheReader = services.ZipReader(this.cacheFile);
            }
            catch (e if e.result == Cr.NS_ERROR_FILE_CORRUPTED) {
                util.reportError(e);
                this.cacheFile.remove(false);
            }

        return this._cacheReader;
    },

    get inQueue() this._cacheWriter && this._cacheWriter.inQueue(),

    getCacheWriter: function () {
        if (!this._cacheWriter)
            try {
                let mode = File.MODE_RDWR;
                if (!this.cacheFile.exists())
                    mode |= File.MODE_CREATE;

                cache._cacheWriter = services.ZipWriter(this.cacheFile, mode);
            }
            catch (e if e.result == Cr.NS_ERROR_FILE_CORRUPTED) {
                util.reportError(e);
                this.cacheFile.remove(false);

                mode |= File.MODE_CREATE;
                cache._cacheWriter = services.ZipWriter(this.cacheFile, mode);
            }
        return this._cacheWriter;
    },

    closeReader: function closeReader() {
        if (cache._cacheReader) {
            this.cacheReader.close();
            delete cache._cacheReader;
        }
    },

    closeWriter: function closeWriter() {
        this.closeReader();

        if (this._cacheWriter) {
            this._cacheWriter.close();
            delete cache._cacheWriter;

            // ZipWriter bug.
            if (this.cacheFile.fileSize <= 22)
                this.cacheFile.remove(false);
        }
    },

    flush: function flush() {
        cache.cache = {};
        if (this.cacheFile.eists()) {
            this.closeReader();

            this.flushJAR(this.cacheFile);
            this.cacheFile.remove(false);
        }
    },

    flushAll: function flushAll(file) {
        this.flushStartup();
        this.flush();
    },

    flushEntry: function flushEntry(name, time) {
        if (this.cacheReader && this.cacheReader.hasEntry(name)) {
            if (time && this.cacheReader.getEntry(name).lastModifiedTime / 1000 >= time)
                return;

            this.queue.push([null, name]);
            cache.processQueue();
        }

        delete this.cache[name];
    },

    flushJAR: function flushJAR(file) {
        services.observer.notifyObservers(file, "flush-cache-entry", "");
    },

    flushStartup: function flushStartup() {
        services.observer.notifyObservers(null, "startupcache-invalidate", "");
    },

    force: function force(name, localOnly) {
        if (this.cacheReader && this.cacheReader.hasEntry(name)) {
            return JSON.parse(File.readStream(
                this.cacheReader.getInputStream(name)));
        }

        if (Set.has(this.localProviders, name) && !this.isLocal) {
            for each (let { cache } in overlay.modules)
                if (cache.has(name))
                    return cache.force(name, true);
        }

        if (Set.has(this.providers, name)) {
            let [func, self] = this.providers[name];
            this.cache[name] = func.call(self || this, name);

            cache.queue.push([Date.now(), name]);
            cache.processQueue();

            return this.cache[name];
        }

        if (this.isLocal && !localOnly)
            return cache.force(name);
    },

    get: function get(name) {
        if (!Set.has(this.cache, name)) {
            this.cache[name] = this.force(name);
            util.assert(this.cache[name] !== undefined,
                        "No such cache key", false);
        }

        return this.cache[name];
    },

    has: function has(name) Set.has(this.providers, name) || set.has(this.cache, name),

    register: function register(name, callback, self) {
        if (this.isLocal)
            Set.add(this.localProviders, name);

        this.providers[name] = [callback, self];
    },

    processQueue: function processQueue() {
        this.closeReader();
        this.closeWriter();

        if (this.queue.length && !this.inQueue) {
            // removeEntry does not work properly with queues.
            for each (let [, entry] in this.queue)
                if (this.getCacheWriter().hasEntry(entry)) {
                    this.getCacheWriter().removeEntry(entry, false);
                    this.closeWriter();
                }

            this.queue.splice(0).forEach(function ([time, entry]) {
                if (time && Set.has(this.cache, entry)) {
                    let stream = services.CharsetConv("UTF-8")
                                         .convertToInputStream(JSON.stringify(this.cache[entry]));

                    this.getCacheWriter().addEntryStream(entry, time * 1000,
                                                         this.compression, stream,
                                                         true);
                }
            }, this);

            if (this._cacheWriter)
                this.getCacheWriter().processQueue(this, null);
        }
    },

    onStopRequest: function onStopRequest() {
        this.processQueue();
    }
});

endModule();

// catch(e){ if (typeof e === "string") e = Error(e); dump(e.fileName+":"+e.lineNumber+": "+e+"\n" + e.stack); }

// vim: set fdm=marker sw=4 sts=4 et ft=javascript:
