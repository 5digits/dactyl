// Copyright (c) 2008-2014 Kris Maglione <maglione.k at Gmail>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
"use strict";

defineModule("storage", {
    exports: ["File", "Storage", "storage"],
    require: ["promises", "services", "util"]
});

lazyRequire("config", ["config"]);
lazyRequire("io", ["IO"]);
lazyRequire("overlay", ["overlay"]);

lazyRequire("resource://gre/modules/osfile.jsm", ["OS"]);

var win32 = /^win(32|nt)$/i.test(services.runtime.OS);
var myObject = JSON.parse("{}").constructor;

var global = Cu.getGlobalForObject(this);

var StoreBase = Class("StoreBase", {
    OPTIONS: ["privateData", "replacer"],

    fireEvent: function (event, arg) { storage.fireEvent(this.name, event, arg); },

    get serial() JSON.stringify(this._object, this.replacer),

    init: function init(name, store, load, options) {
        this._load = load;
        this._options = options;

        this.__defineGetter__("store", () => store);
        this.__defineGetter__("name", () => name);
        for (let [k, v] in Iterator(options))
            if (this.OPTIONS.indexOf(k) >= 0)
                this[k] = v;
        this.reload();
    },

    clone: function clone(storage) {
        let store = storage.privateMode ? false : this.store;
        let res = this.constructor(this.name, store, this._load, this._options);
        res.storage = storage;
        return res;
    },

    makeOwn: function makeOwn(val) {
        if (typeof val != "object")
            return val;
        if (Cu.getGlobalForObject(val) == global)
            return val;
        return JSON.parse(JSON.stringify(val, this.replacer));
    },

    changed: function () { this.timer && this.timer.tell(); },

    reload: function reload() {
        this._object = this._load() || this._constructor();
        this.fireEvent("change", null);
    },

    delete: function delete_() {
        delete storage.keys[this.name];
        delete storage[this.name];
        return OS.File.remove(
            storage.infoPath.child(this.name).path);
    },

    save: function () { (self.storage || storage)._saveData(this); },

    __iterator__: function () Iterator(this._object)
});

var ArrayStore = Class("ArrayStore", StoreBase, {
    _constructor: Array,

    get length() this._object.length,

    set: function set(index, value, quiet) {
        var orig = this._object[index];
        this._object[index] = this.makeOwn(value);
        if (!quiet)
            this.fireEvent("change", index);

        return orig;
    },

    push: function push(value) {
        this._object.push(this.makeOwn(value));
        this.fireEvent("push", this._object.length);
    },

    pop: function pop(value, ord) {
        if (ord == null)
            var res = this._object.pop();
        else
            res = this._object.splice(ord, 1)[0];

        this.fireEvent("pop", this._object.length, ord);
        return res;
    },

    shift: function shift(value) {
        var res = this._object.shift();
        this.fireEvent("shift", this._object.length);
        return res;
    },

    insert: function insert(value, ord) {
        value = this.makeOwn(value);
        if (ord == 0)
            this._object.unshift(value);
        else
            this._object = this._object.slice(0, ord)
                               .concat([value])
                               .concat(this._object.slice(ord));
        this.fireEvent("insert", this._object.length, ord);
    },

    truncate: function truncate(length, fromEnd) {
        var res = this._object.length;
        if (this._object.length > length) {
            if (fromEnd)
                this._object.splice(0, this._object.length - length);
            this._object.length = length;
            this.fireEvent("truncate", length);
        }
        return res;
    },

    // XXX: Awkward.
    mutate: function mutate(funcName) {
        var _funcName = funcName;
        arguments[0] = this._object;
        this._object = Array[_funcName].apply(Array, arguments)
                                       .map(this.makeOwn.bind(this));
        this.fireEvent("change", null);
    },

    get: function get(index) index >= 0 ? this._object[index] : this._object[this._object.length + index]
});

var ObjectStore = Class("ObjectStore", StoreBase, {
    _constructor: myObject,

    clear: function () {
        this._object = {};
        this.fireEvent("clear");
    },

    get: function get(key, default_) {
        return this.has(key)        ? this._object[key] :
               arguments.length > 1 ? this.set(key, default_) :
                                      undefined;
    },

    has: function has(key) hasOwnProperty(this._object, key),

    keys: function keys() Object.keys(this._object),

    remove: function remove(key) {
        var res = this._object[key];
        delete this._object[key];
        this.fireEvent("remove", key);
        return res;
    },

    set: function set(key, val) {
        var defined = key in this._object;
        var orig = this._object[key];
        this._object[key] = this.makeOwn(val);
        if (!defined)
            this.fireEvent("add", key);
        else if (orig != val)
            this.fireEvent("change", key);
        return val;
    }
});

var sessionGlobal = Cu.import("resource://gre/modules/Services.jsm", {});

var Storage = Module("Storage", {
    Local: function Local(dactyl, modules, window) ({
        init: function init() {
            this.privateMode = PrivateBrowsingUtils.isWindowPrivate(window);
        }
    }),

    alwaysReload: {},

    init: function init() {
        this.cleanup();

        let { Services } = Cu.import("resource://gre/modules/Services.jsm", {});
        if (!Services.dactylSession)
            Services.dactylSession = Cu.createObjectIn(sessionGlobal);
        this.session = Services.dactylSession;
    },

    cleanup: function () {
        this.saveAll();

        for (let key in keys(this.keys)) {
            if (this[key].timer)
                this[key].timer.flush();
            delete this[key];
        }

        this.keys = {};
        this.observers = {};
    },

    _loadData: function loadData(name, store, type) {
        try {
            let file = storage.infoPath.child(name);
            if (file.exists()) {
                let data = file.read();
                let result = JSON.parse(data);
                if (result instanceof type)
                    return result;
            }
        }
        catch (e) {
            util.reportError(e);
        }
    },

    _saveData: promises.task(function saveData(obj) {
        if (obj.privateData && storage.privateMode)
            return;
        if (obj.store && storage.infoPath) {
            var { path } = storage.infoPath.child(obj.name);
            yield OS.File.makeDir(storage.infoPath.path,
                                  { ignoreExisting: true });
            yield OS.File.writeAtomic(
                path, obj.serial,
                { tmpPath: path + ".part" });
        }
    }),

    storeForSession: function storeForSession(key, val) {
        if (val)
            this.session[key] = sessionGlobal.JSON.parse(JSON.stringify(val));
        else
            delete this.dactylSession[key];
    },

    infoPath: Class.Memoize(() =>
        File(IO.runtimePath.replace(/,.*/, ""))
            .child("info").child(config.profileName)),

    exists: function exists(key) this.infoPath.child(key).exists(),

    remove: function remove(key) {
        if (this.exists(key)) {
            if (this[key] && this[key].timer)
                this[key].timer.flush();
            delete this[key];
            delete this.keys[key];
            return OS.File.remove(
                this.infoPath.child(key).path);
        }
    },

    newObject: function newObject(key, constructor, params={}) {
        if (params == null || !isObject(params))
            throw Error("Invalid argument type");

        if (this.isLocalModule) {
            this.globalInstance.newObject.apply(this.globalInstance, arguments);

            if (!(key in this.keys) && this.privateMode && key in this.globalInstance.keys) {
                let obj = this.globalInstance.keys[key];
                this.keys[key] = this._privatize(obj);
            }

            return this.keys[key];
        }

        let reload = params.reload || this.alwaysReload[key];
        if (!(key in this.keys) || reload) {
            if (key in this && !reload)
                throw Error("Cannot add storage key with that name.");

            let load = () => this._loadData(key, params.store, params.type || myObject);

            this.keys[key] = new constructor(key, params.store, load, params);
            this.keys[key].timer = new Timer(1000, 10000, () => this.save(key));
            this.__defineGetter__(key, function () this.keys[key]);
        }
        return this.keys[key];
    },

    newMap: function newMap(key, options={}) {
        return this.newObject(key, ObjectStore, options);
    },

    newArray: function newArray(key, options={}) {
        return this.newObject(key, ArrayStore, update({ type: Array }, options));
    },

    get observerMaps() {
        yield this.observers;
        for (let window of overlay.windows)
            yield overlay.getData(window, "storage-observers", Object);
    },

    addObserver: function addObserver(key, callback, window) {
        var { observers } = this;
        if (window instanceof Ci.nsIDOMWindow)
            observers = overlay.getData(window, "storage-observers", Object);

        if (!hasOwnProperty(observers, key))
            observers[key] = RealSet();

        observers[key].add(callback);
    },

    removeObserver: function (key, callback) {
        for (let observers in this.observerMaps)
            if (key in observers)
                observers[key].remove(callback);
    },

    fireEvent: function fireEvent(key, event, arg) {
        for (let observers in this.observerMaps)
            for (let observer of observers[key] || [])
                observer(key, event, arg);

        if (key in this.keys && this.keys[key].timer)
            this[key].timer.tell();
    },

    load: function load(key) {
        if (this[key].store && this[key].reload)
            this[key].reload();
    },

    save: function save(key) {
        if (this[key])
            this._saveData(this.keys[key]);
    },

    saveAll: function storeAll() {
        for each (let obj in this.keys)
            this._saveData(obj);
    },

    _privateMode: false,
    get privateMode() this._privateMode,
    set privateMode(enabled) {
        this._privateMode = Boolean(enabled);

        if (this.isLocalModule) {
            this.saveAll();

            if (!enabled)
                delete this.keys;
            else {
                let { keys } = this;
                this.keys = {};
                for (let [k, v] in Iterator(keys))
                    this.keys[k] = this._privatize(v);
            }
        }
        return this._privateMode;
    },

    _privatize: function privatize(obj) {
        if (obj.privateData && obj.clone)
            return obj.clone(this);
        return obj;
    },
}, {
    Replacer: {
        skipXpcom: function skipXpcom(key, val) val instanceof Ci.nsISupports ? null : val
    }
}, {
    cleanup: function (dactyl, modules, window) {
        overlay.setData(window, "storage-callbacks", undefined);
    }
});

/**
 * @class File A class to wrap nsIFile objects and simplify operations
 * thereon.
 *
 * @param {nsIFile|string} path Expanded according to {@link IO#expandPath}
 * @param {boolean} checkPWD Whether to allow expansion relative to the
 *          current directory. @default true
 * @param {string} charset The charset of the file. @default File.defaultEncoding
 */
var File = Class("File", {
    init: function (path, checkPWD, charset) {
        let file = services.File();

        if (charset)
            this.charset = charset;

        if (path instanceof Ci.nsIFileURL)
            path = path.file;

        if (path instanceof Ci.nsIFile || path instanceof File)
            file = path.clone();
        else if (/file:\/\//.test(path))
            file = services["file:"].getFileFromURLSpec(path);
        else {
            try {
                let expandedPath = File.expandPath(path);

                if (!File.isAbsolutePath(expandedPath) && checkPWD)
                    file = checkPWD.child(expandedPath);
                else
                    file.initWithPath(expandedPath);
            }
            catch (e) {
                util.reportError(e);
                return File.DoesNotExist(path, e);
            }
        }
        this.file = file.QueryInterface(Ci.nsILocalFile);
        return this;
    },

    charset: Class.Memoize(() => File.defaultEncoding),

    /**
     * @property {nsIFileURL} Returns the nsIFileURL object for this file.
     */
    URI: Class.Memoize(function () {
        let uri = services.io.newFileURI(this.file)
                          .QueryInterface(Ci.nsIFileURL);
        uri.QueryInterface(Ci.nsIMutable).mutable = false;
        return uri;
    }),

    /**
     * Iterates over the objects in this directory.
     */
    iterDirectory: function iterDirectory() {
        if (!this.exists())
            throw Error(_("io.noSuchFile"));
        if (!this.isDirectory())
            throw Error(_("io.eNotDir"));
        for (let file in iter(this.directoryEntries))
            yield File(file);
    },

    /**
     * Returns a new file for the given child of this directory entry.
     */
    child: function child(...args) {
        let f = this.constructor(this);
        for (let name of args)
            for (let elem of name.split(File.pathSplit))
                f.append(elem);
        return f;
    },

    /**
     * Returns an iterator for all lines in a file.
     */
    get lines() File.readLines(services.FileInStream(this.file, -1, 0, 0),
                               this.charset),

    /**
     * Reads this file's entire contents in "text" mode and returns the
     * content as a string.
     *
     * @param {string} encoding The encoding from which to decode the file.
     *          @default #charset
     * @returns {string}
     */
    read: function read(encoding) {
        let ifstream = services.FileInStream(this.file, -1, 0, 0);

        return File.readStream(ifstream, encoding || this.charset);
    },

    /**
     * Returns the list of files in this directory.
     *
     * @param {boolean} sort Whether to sort the returned directory
     *     entries.
     * @returns {[nsIFile]}
     */
    readDirectory: function readDirectory(sort) {
        if (!this.isDirectory())
            throw Error(_("io.eNotDir"));

        let array = [e for (e in this.iterDirectory())];
        if (sort)
            array.sort((a, b) => (b.isDirectory() - a.isDirectory() ||
                                  String.localeCompare(a.path, b.path)));
        return array;
    },

    /**
     * Returns a new nsIFileURL object for this file.
     *
     * @returns {nsIFileURL}
     */
    toURI: function toURI() services.io.newFileURI(this.file),

    /**
     * Writes the string *buf* to this file.
     *
     * @param {string} buf The file content.
     * @param {string|number} mode The file access mode, a bitwise OR of
     *     the following flags:
     *       {@link #MODE_RDONLY}:   0x01
     *       {@link #MODE_WRONLY}:   0x02
     *       {@link #MODE_RDWR}:     0x04
     *       {@link #MODE_CREATE}:   0x08
     *       {@link #MODE_APPEND}:   0x10
     *       {@link #MODE_TRUNCATE}: 0x20
     *       {@link #MODE_SYNC}:     0x40
     *     Alternatively, the following abbreviations may be used:
     *       ">"  is equivalent to {@link #MODE_WRONLY} | {@link #MODE_CREATE} | {@link #MODE_TRUNCATE}
     *       ">>" is equivalent to {@link #MODE_WRONLY} | {@link #MODE_CREATE} | {@link #MODE_APPEND}
     * @default ">"
     * @param {number} perms The file mode bits of the created file. This
     *     is only used when creating a new file and does not change
     *     permissions if the file exists.
     * @default 0644
     * @param {string} encoding The encoding to used to write the file.
     * @default #charset
     */
    write: function write(buf, mode, perms, encoding) {
        function getStream(defaultChar) {
            return services.ConvOutStream(ofstream, encoding, 0, defaultChar);
        }
        if (buf instanceof File)
            buf = buf.read();

        if (!encoding)
            encoding = this.charset;

        if (mode == ">>")
            mode = File.MODE_WRONLY | File.MODE_CREATE | File.MODE_APPEND;
        else if (!mode || mode == ">")
            mode = File.MODE_WRONLY | File.MODE_CREATE | File.MODE_TRUNCATE;

        if (!perms)
            perms = 0o644;
        if (!this.exists()) // OCREAT won't create the directory
            this.create(this.NORMAL_FILE_TYPE, perms);

        let ofstream = services.FileOutStream(this.file, mode, perms, 0);
        try {
            var ocstream = getStream(0);
            ocstream.writeString(buf);
        }
        catch (e if e.result == Cr.NS_ERROR_LOSS_OF_SIGNIFICANT_DATA) {
            ocstream.close();
            ocstream = getStream("?".charCodeAt(0));
            ocstream.writeString(buf);
            return false;
        }
        finally {
            try {
                ocstream.close();
            }
            catch (e) {}
            ofstream.close();
        }
        return true;
    },

    // Wrapped native methods:
    copyTo: function copyTo(dir, name)
        this.file.copyTo(this.constructor(dir).file,
                         name),

    copyToFollowingLinks: function copyToFollowingLinks(dir, name)
        this.file.copyToFollowingLinks(this.constructor(dir).file,
                                       name),

    moveTo: function moveTo(dir, name)
        this.file.moveTo(this.constructor(dir).file,
                         name),

    equals: function equals(file)
        this.file.equals(this.constructor(file).file),

    contains: function contains(dir, recur)
        this.file.contains(this.constructor(dir).file,
                           recur),

    getRelativeDescriptor: function getRelativeDescriptor(file)
        this.file.getRelativeDescriptor(this.constructor(file).file),

    setRelativeDescriptor: function setRelativeDescriptor(file, path)
        this.file.setRelativeDescriptor(this.constructor(file).file,
                                        path)
}, {
    /**
     * @property {number} Open for reading only.
     * @final
     */
    MODE_RDONLY: 0x01,

    /**
     * @property {number} Open for writing only.
     * @final
     */
    MODE_WRONLY: 0x02,

    /**
     * @property {number} Open for reading and writing.
     * @final
     */
    MODE_RDWR: 0x04,

    /**
     * @property {number} If the file does not exist, the file is created.
     *     If the file exists, this flag has no effect.
     * @final
     */
    MODE_CREATE: 0x08,

    /**
     * @property {number} The file pointer is set to the end of the file
     *     prior to each write.
     * @final
     */
    MODE_APPEND: 0x10,

    /**
     * @property {number} If the file exists, its length is truncated to 0.
     * @final
     */
    MODE_TRUNCATE: 0x20,

    /**
     * @property {number} If set, each write will wait for both the file
     *     data and file status to be physically updated.
     * @final
     */
    MODE_SYNC: 0x40,

    /**
     * @property {number} With MODE_CREATE, if the file does not exist, the
     *     file is created. If the file already exists, no action and NULL
     *     is returned.
     * @final
     */
    MODE_EXCL: 0x80,

    /**
     * @property {string} The current platform's path separator.
     */
    PATH_SEP: Class.Memoize(function () {
        let f = services.directory.get("CurProcD", Ci.nsIFile);
        f.append("foo");
        return f.path.substr(f.parent.path.length, 1);
    }),

    pathSplit: Class.Memoize(function () util.regexp("(?:/|" + util.regexp.escape(this.PATH_SEP) + ")", "g")),

    DoesNotExist: function DoesNotExist(path, error) ({
        path: path,
        exists: function () false,
        __noSuchMethod__: function () { throw error || Error("Does not exist"); }
    }),

    defaultEncoding: "UTF-8",

    /**
     * Expands "~" and environment variables in *path*.
     *
     * "~" is expanded to to the value of $HOME. On Windows if this is not
     * set then the following are tried in order:
     *   $USERPROFILE
     *   ${HOMDRIVE}$HOMEPATH
     *
     * The variable notation is $VAR (terminated by a non-word character)
     * or ${VAR}. %VAR% is also supported on Windows.
     *
     * @param {string} path The unexpanded path string.
     * @param {boolean} relative Whether the path is relative or absolute.
     * @returns {string}
     */
    expandPath: function expandPath(path, relative) {
        function getenv(name) services.environment.get(name);

        // expand any $ENV vars - this is naive but so is Vim and we like to be compatible
        // TODO: Vim does not expand variables set to an empty string (and documents it).
        // Kris reckons we shouldn't replicate this 'bug'. --djk
        // TODO: should we be doing this for all paths?
        function expand(path) path.replace(
            win32 ? /\$(\w+)\b|\${(\w+)}|%(\w+)%/g
                  : /\$(\w+)\b|\${(\w+)}/g,
            (m, n1, n2, n3) => (getenv(n1 || n2 || n3) || m));
        path = expand(path);

        // expand ~
        // Yuck.
        if (!relative && RegExp("~(?:$|[/" + util.regexp.escape(File.PATH_SEP) + "])").test(path)) {
            // Try $HOME first, on all systems
            let home = getenv("HOME");

            // Windows has its own idiosyncratic $HOME variables.
            if (win32 && (!home || !File(home).exists()))
                home = getenv("USERPROFILE") ||
                       getenv("HOMEDRIVE") + getenv("HOMEPATH");

            path = home + path.substr(1);
        }

        // TODO: Vim expands paths twice, once before checking for ~, once
        // after, but doesn't document it. Is this just a bug? --Kris
        path = expand(path);
        return path.replace("/", File.PATH_SEP, "g");
    },

    expandPathList: function (list) list.map(this.expandPath),

    readURL: function readURL(url, encoding) {
        let channel = services.io.newChannel(url, null, null);
        channel.contentType = "text/plain";
        return this.readStream(channel.open(), encoding);
    },

    readStream: function readStream(ifstream, encoding) {
        try {
            var icstream = services.CharsetStream(
                    ifstream, encoding || File.defaultEncoding, 4096, // buffer size
                    services.CharsetStream.DEFAULT_REPLACEMENT_CHARACTER);

            let buffer = [];
            let str = {};
            while (icstream.readString(4096, str) != 0)
                buffer.push(str.value);
            return buffer.join("");
        }
        finally {
            icstream.close();
            ifstream.close();
        }
    },

    readLines: function readLines(ifstream, encoding) {
        try {
            var icstream = services.CharsetStream(
                    ifstream, encoding || File.defaultEncoding, 4096, // buffer size
                    services.CharsetStream.DEFAULT_REPLACEMENT_CHARACTER);

            var value = {};
            while (icstream.readLine(value))
                yield value.value;
        }
        finally {
            icstream.close();
            ifstream.close();
        }
    },

    isAbsolutePath: function isAbsolutePath(path) {
        try {
            services.File().initWithPath(path);
            return true;
        }
        catch (e) {
            return false;
        }
    },

    joinPaths: function joinPaths(head, tail, cwd) {
        let path = this(head, cwd);
        try {
            // FIXME: should only expand environment vars and normalize path separators
            path.appendRelativePath(this.expandPath(tail, true));
        }
        catch (e) {
            return File.DoesNotExist(e);
        }
        return path;
    },

    replacePathSep: function (path) path.replace("/", File.PATH_SEP, "g")
});

let (file = services.directory.get("ProfD", Ci.nsIFile)) {
    Object.keys(file).forEach(function (prop) {
        if (!(prop in File.prototype)) {
            let isFunction;
            try {
                isFunction = callable(file[prop]);
            }
            catch (e) {}

            if (isFunction)
                File.prototype[prop] = util.wrapCallback(function wrapper() this.file[prop].apply(this.file, arguments));
            else
                Object.defineProperty(File.prototype, prop, {
                    configurable: true,
                    get: function wrap_get() this.file[prop],
                    set: function wrap_set(val) { this.file[prop] = val; }
                });
        }
    });
    file = null;
}

endModule();

// catch(e){ dump(e + "\n" + (e.stack || Error().stack)); Components.utils.reportError(e) }

// vim: set fdm=marker sw=4 sts=4 ts=8 et ft=javascript:
