// Copyright (c) 2011-2014 Kris Maglione <maglione.k@gmail.com>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
"use strict";

defineModule("cache", {
    exports: ["Cache", "cache"],
    require: ["config", "services", "util"]
});

lazyRequire("overlay", ["overlay"]);
lazyRequire("storage", ["File", "storage"]);

var Cache = Module("Cache", XPCOM(Ci.nsIRequestObserver), {
    init: function init() {
        this.queue = [];
        this.storage = storage.newMap("cache", { store: true });
        this.providers = {};
        this.globalProviders = this.providers;
        this.providing = RealSet();
        this.localProviders = RealSet();

        if (JSMLoader.cacheFlush)
            this.flush();

        update(services["dactyl:"].providers, {
            "cache": (uri, path) => {
                let contentType = "text/plain";
                try {
                    contentType = services.mime.getTypeFromURI(uri);
                }
                catch (e) {}

                if (this.storage.has(path) ||
                    !this.cacheReader ||
                    !this.cacheReader.hasEntry(path))
                    return [contentType, this.force(path)];

                let channel = services.StreamChannel(uri);
                try {
                    channel.contentStream = this.cacheReader.getInputStream(path);
                }
                catch (e if e.result = Cr.NS_ERROR_FILE_CORRUPTED) {
                    this.flushDiskCache();
                    throw e;
                }
                channel.contentType = contentType;
                channel.contentCharset = "UTF-8";
                return channel;
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

    parse: function parse(str) {
        if ('{['.contains(str[0]))
            return JSON.parse(str);
        return str;
    },

    stringify: function stringify(obj) {
        if (isString(obj))
            return obj;
        return JSON.stringify(obj);
    },

    compression: 9,

    cacheFile: Class.Memoize(function () {
        let dir = File(services.directory.get("ProfD", Ci.nsIFile))
                    .child("dactyl");
        if (!dir.exists())
            dir.create(dir.DIRECTORY_TYPE, 0o777);
        return dir.child("cache.zip");
    }),

    get cacheReader() {
        if (!this._cacheReader && this.cacheFile.exists()
                && !this.inQueue)
            try {
                this._cacheReader = services.ZipReader(this.cacheFile.file);
            }
            catch (e if e.result == Cr.NS_ERROR_FILE_CORRUPTED) {
                util.reportError(e);
                this.flushDiskCache();
            }

        return this._cacheReader;
    },

    get inQueue() this._cacheWriter && this._cacheWriter.inQueue,

    getCacheWriter: function () {
        if (!this._cacheWriter)
            try {
                let mode = File.MODE_RDWR;
                if (!this.cacheFile.exists())
                    mode |= File.MODE_CREATE;

                cache._cacheWriter = services.ZipWriter(this.cacheFile.file, mode);
            }
            catch (e if e.result == Cr.NS_ERROR_FILE_CORRUPTED) {
                util.reportError(e);
                this.cacheFile.remove(false);

                mode |= File.MODE_CREATE;
                cache._cacheWriter = services.ZipWriter(this.cacheFile.file, mode);
            }
        return this._cacheWriter;
    },

    closeReader: function closeReader() {
        if (cache._cacheReader) {
            this.cacheReader.close();
            cache._cacheReader = null;
        }
    },

    closeWriter: util.wrapCallback(function closeWriter() {
        this.closeReader();

        if (this._cacheWriter) {
            this._cacheWriter.close();
            cache._cacheWriter = null;

            // ZipWriter bug.
            if (this.cacheFile.fileSize <= 22)
                this.cacheFile.remove(false);
        }
    }),

    flush: function flush(filter) {
        if (filter) {
            this.storage.keys().filter(filter)
                .forEach(bind("remove", this.storage));
        }
        else {
            this.storage.clear();
            this.flushDiskCache();
        }
    },

    flushDiskCache: function flushDiskCache() {
        if (this.cacheFile.exists()) {
            this.closeWriter();

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

        this.storage.remove(name);
    },

    flushJAR: function flushJAR(file) {
        services.observer.notifyObservers(File(file).file, "flush-cache-entry", "");
    },

    flushStartup: function flushStartup() {
        services.observer.notifyObservers(null, "startupcache-invalidate", "");
    },

    force: function force(name, localOnly) {
        if (this.storage.has(name))
            return this.storage.get(name);

        util.waitFor(() => !this.inQueue);

        if (this.cacheReader && this.cacheReader.hasEntry(name)) {
            try {
                return this.parse(File.readStream(
                    this.cacheReader.getInputStream(name)));
            }
            catch (e if e.result == Cr.NS_ERROR_FILE_CORRUPTED) {
                this.flushDiskCache();
            }
        }

        if (this.localProviders.has(name) && !this.isLocal) {
            for (let { cache } of overlay.modules)
                if (cache._has(name))
                    return cache.force(name, true);
        }

        if (hasOwnProperty(this.providers, name)) {
            util.assert(!this.providing.add(name),
                        "Already generating cache for " + name,
                        false);

            let [func, long] = this.providers[name];
            try {
                var value = func.call(this, name);
            }
            finally {
                this.providing.delete(name);
            }

            if (!long)
                this.storage.set(name, value);
            else {
                cache.queue.push([Date.now(), name, value]);
                cache.processQueue();
            }

            return value;
        }

        if (this.isLocal && !localOnly)
            return cache.force(name);
    },

    get: function get(name, callback, long) {
        if (this.storage.has(name))
            return this.storage.get(name);

        if (callback && !(hasOwnProperty(this.providers, name) ||
                          this.localProviders.has(name)))
            this.register(name, callback, long);

        var result = this.force(name);
        util.assert(result !== undefined, "No such cache key", false);

        return result;
    },

    _has: function _has(name) hasOwnProperty(this.providers, name)
                           || this.storage.has(name),

    has: function has(name) [this.globalProviders, this.localProviders]
            .some(obj => isinstance(obj, ["Set"]) ? obj.has(name)
                                                  : hasOwnProperty(obj, name)),

    register: function register(name, callback, long) {
        if (this.isLocal)
            this.localProviders.add(name);

        this.providers[name] = [callback, long];
    },

    processQueue: function processQueue() {
        this.closeReader();
        this.closeWriter();

        if (this.queue.length && !this.inQueue) {
            // removeEntry does not work properly with queues.
            let removed = 0;
            for (let [, entry] of this.queue)
                if (this.getCacheWriter().hasEntry(entry)) {
                    this.getCacheWriter().removeEntry(entry, false);
                    removed++;
                }
            if (removed) {
                this.closeWriter();
                util.flushCache(this.cacheFile);
            }

            this.queue.splice(0).forEach(function ([time, entry, value]) {
                if (time && value != null) {
                    let stream = services.CharsetConv("UTF-8")
                                         .convertToInputStream(this.stringify(value));

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

// vim: set fdm=marker sw=4 sts=4 ts=8 et ft=javascript:
