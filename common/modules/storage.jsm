// Copyright (c) 2008-2010 by Kris Maglione <maglione.k at Gmail>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
"use strict";

if (this.XPCSafeJSObjectWrapper == null)
    this.XPCSafeJSObjectWrapper = XPCNativeWrapper;

const myObject = Object;
Components.utils.import("resource://dactyl/base.jsm");
defineModule("storage", {
    exports: ["File", "storage"],
    require: ["services", "util"]
});

const win32 = /^win(32|nt)$/i.test(services.get("runtime").OS);

function getFile(name) {
    let file = storage.infoPath.clone();
    file.append(name);
    return File(file);
}

function loadData(name, store, type) {
    try {
        if (storage.infoPath)
            var file = getFile(name).read();
        if (file)
            var result = services.get("json").decode(file);
        if (result instanceof type)
            return result;
    }
    catch (e) {}
}

function saveData(obj) {
    if (obj.privateData && storage.privateMode)
        return;
    if (obj.store && storage.infoPath)
        getFile(obj.name).write(obj.serial);
}

const StoreBase = Class("StoreBase", {
    OPTIONS: ["privateData", "replacer"],
    fireEvent: function (event, arg) { storage.fireEvent(this.name, event, arg); },
    get serial() JSON.stringify(this._object, this.replacer),
    init: function (name, store, load, options) {
        this._load = load;

        this.__defineGetter__("store", function () store);
        this.__defineGetter__("name", function () name);
        for (let [k, v] in Iterator(options))
            if (this.OPTIONS.indexOf(k) >= 0)
                this[k] = v;
        this.reload();
    },
    changed: function () { this.timer.tell() },
    reload: function reload() {
        this._object = this._load() || this._constructor();
        this.fireEvent("change", null);
    },
    save: function () { saveData(this); },
});

const ArrayStore = Class("ArrayStore", StoreBase, {
    _constructor: Array,

    get length() this._object.length,

    set: function set(index, value) {
        var orig = this._object[index];
        this._object[index] = value;
        this.fireEvent("change", index);
    },

    push: function push(value) {
        this._object.push(value);
        this.fireEvent("push", this._object.length);
    },

    pop: function pop(value) {
        var ret = this._object.pop();
        this.fireEvent("pop", this._object.length);
        return ret;
    },

    truncate: function truncate(length, fromEnd) {
        var ret = this._object.length;
        if (this._object.length > length) {
            if (fromEnd)
                this._object.splice(0, this._object.length - length);
            this._object.length = length;
            this.fireEvent("truncate", length);
        }
        return ret;
    },

    // XXX: Awkward.
    mutate: function mutate(funcName) {
        var _funcName = funcName;
        arguments[0] = this._object;
        this._object = Array[_funcName].apply(Array, arguments);
        this.fireEvent("change", null);
    },

    get: function get(index) index >= 0 ? this._object[index] : this._object[this._object.length + index],

    __iterator__: function () Iterator(this._object),
});

const ObjectStore = Class("ObjectStore", StoreBase, {
    _constructor: myObject,

    clear: function () {
        this._object = {};
        this.fireEvent("clear");
    },

    get: function get(key, default_)
        key in this._object  ? this._object[key] :
        arguments.length > 1 ? this.set(key, default_) :
                               undefined,

    keys: function keys() Object.keys(this._object),

    remove: function remove(key) {
        var ret = this._object[key];
        delete this._object[key];
        this.fireEvent("remove", key);
    },

    set: function set(key, val) {
        var defined = key in this._object;
        var orig = this._object[key];
        this._object[key] = val;
        if (!defined)
            this.fireEvent("add", key);
        else if (orig != val)
            this.fireEvent("change", key);
        return val;
    },

    __iterator__: function () Iterator(this._object),
});

var keys = {};
var observers = {};

const Storage = Module("Storage", {
    alwaysReload: {},

    newObject: function newObject(key, constructor, params) {
        if (params == null || !isObject(params))
            throw Error("Invalid argument type");

        if (!(key in keys) || params.reload || this.alwaysReload[key]) {
            if (key in this && !(params.reload || this.alwaysReload[key]))
                throw Error();
            let load = function () loadData(key, params.store, params.type || myObject);
            keys[key] = new constructor(key, params.store, load, params);
            keys[key].timer = new Timer(1000, 10000, function () storage.save(key));
            this.__defineGetter__(key, function () keys[key]);
        }
        return keys[key];
    },

    newMap: function newMap(key, options) {
        return this.newObject(key, ObjectStore, options);
    },

    newArray: function newArray(key, options) {
        return this.newObject(key, ArrayStore, update({ type: Array }, options));
    },

    addObserver: function addObserver(key, callback, ref) {
        if (ref) {
            if (!ref.dactylStorageRefs)
                ref.dactylStorageRefs = [];
            ref.dactylStorageRefs.push(callback);
            var callbackRef = Cu.getWeakReference(callback);
        }
        else {
            callbackRef = { get: function () callback };
        }
        this.removeDeadObservers();
        if (!(key in observers))
            observers[key] = [];
        if (!observers[key].some(function (o) o.callback.get() == callback))
            observers[key].push({ ref: ref && Cu.getWeakReference(ref), callback: callbackRef });
    },

    removeObserver: function (key, callback) {
        this.removeDeadObservers();
        if (!(key in observers))
            return;
        observers[key] = observers[key].filter(function (elem) elem.callback.get() != callback);
        if (observers[key].length == 0)
            delete obsevers[key];
    },

    removeDeadObservers: function () {
        for (let [key, ary] in Iterator(observers)) {
            observers[key] = ary = ary.filter(function (o) o.callback.get() && (!o.ref || o.ref.get() && o.ref.get().dactylStorageRefs));
            if (!ary.length)
                delete observers[key];
        }
    },

    get observers() observers,

    fireEvent: function fireEvent(key, event, arg) {
        this.removeDeadObservers();
        // Safe, since we have our own Array object here.
        if (key in observers)
            for each (let observer in observers[key])
                observer.callback.get()(key, event, arg);
        if (key in keys)
            this[key].timer.tell();
    },

    load: function load(key) {
        if (this[key].store && this[key].reload)
            this[key].reload();
    },

    save: function save(key) {
        saveData(keys[key]);
    },

    saveAll: function storeAll() {
        for each (let obj in keys)
            saveData(obj);
    },

    _privateMode: false,
    get privateMode() this._privateMode,
    set privateMode(val) {
        if (val && !this._privateMode)
            this.saveAll();
        if (!val && this._privateMode)
            for (let key in keys)
                this.load(key);
        return this._privateMode = Boolean(val);
    }
}, {
}, {
    init: function (dactyl, modules) {
        let infoPath = File(modules.IO.runtimePath.replace(/,.*/, ""));
        if (infoPath) {
            infoPath.append("info");
            infoPath.append(dactyl.profileName);
            storage.infoPath = infoPath;
        }
    }
});

/**
 * @class File A class to wrap nsIFile objects and simplify operations
 * thereon.
 *
 * @param {nsIFile|string} path Expanded according to {@link IO#expandPath}
 * @param {boolean} checkPWD Whether to allow expansion relative to the
 *          current directory. @default true
 */
const File = Class("File", {
    init: function (path, checkPWD) {
        let file = services.create("file");

        if (path instanceof Ci.nsIFile)
            file = path.QueryInterface(Ci.nsIFile);
        else if (/file:\/\//.test(path))
            file = services.create("file:").getFileFromURLSpec(path);
        else {
            try {
                let expandedPath = File.expandPath(path);

                if (!File.isAbsolutePath(expandedPath) && checkPWD)
                    file = File.joinPaths(checkPWD, expandedPath);
                else
                    file.initWithPath(expandedPath);
            }
            catch (e) {
                util.reportError(e);
                return null;
            }
        }
        let self = XPCSafeJSObjectWrapper(file);
        self.__proto__ = this;
        return self;
    },

    /**
     * Iterates over the objects in this directory.
     */
    iterDirectory: function () {
        if (!this.isDirectory())
            throw Error("Not a directory");
        for (let file in iter(this.directoryEntries))
            yield File(file);
    },

    /**
     * Reads this file's entire contents in "text" mode and returns the
     * content as a string.
     *
     * @param {string} encoding The encoding from which to decode the file.
     *          @default options["fileencoding"]
     * @returns {string}
     */
    read: function (encoding) {
        let ifstream = Cc["@mozilla.org/network/file-input-stream;1"].createInstance(Ci.nsIFileInputStream);

        ifstream.init(this, -1, 0, 0);

        try {
            if (encoding instanceof Ci.nsIOutputStream) {
                let l, len = 0;
                while ((l = encoding.writeFrom(ifstream, 4096)) != 0)
                    len += l;
                return len;
            }
            else {
                var icstream = Cc["@mozilla.org/intl/converter-input-stream;1"].createInstance(Ci.nsIConverterInputStream);
                icstream.init(ifstream, encoding || File.defaultEncoding, 4096, // 4096 bytes buffering
                              Ci.nsIConverterInputStream.DEFAULT_REPLACEMENT_CHARACTER);
                let buffer = [];
                let str = {};
                while (icstream.readString(4096, str) != 0)
                    buffer.push(str.value);
                return buffer.join("");
            }
        }
        finally {
            if (icstream)
                icstream.close();
            ifstream.close();
        }
    },

    /**
     * Returns the list of files in this directory.
     *
     * @param {boolean} sort Whether to sort the returned directory
     *     entries.
     * @returns {nsIFile[]}
     */
    readDirectory: function (sort) {
        if (!this.isDirectory())
            throw Error("Not a directory");

        let array = [e for (e in this.iterDirectory())];
        if (sort)
            array.sort(function (a, b) b.isDirectory() - a.isDirectory() || String.localeCompare(a.path, b.path));
        return array;
    },

    /**
     * Writes the string <b>buf</b> to this file.
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
     * @default options["fileencoding"]
     */
    write: function (buf, mode, perms, encoding) {
        let ofstream = Cc["@mozilla.org/network/file-output-stream;1"].createInstance(Ci.nsIFileOutputStream);
        function getStream(defaultChar) {
            let stream = Cc["@mozilla.org/intl/converter-output-stream;1"].createInstance(Ci.nsIConverterOutputStream);
            stream.init(ofstream, encoding, 0, defaultChar);
            return stream;
        }
        if (buf instanceof File)
            buf = buf.read();

        if (!encoding)
            encoding = File.defaultEncoding;

        if (mode == ">>")
            mode = File.MODE_WRONLY | File.MODE_CREATE | File.MODE_APPEND;
        else if (!mode || mode == ">")
            mode = File.MODE_WRONLY | File.MODE_CREATE | File.MODE_TRUNCATE;

        if (!perms)
            perms = parseInt('0644', 8);
        if (!this.exists()) // OCREAT won't create the directory
            this.create(this.NORMAL_FILE_TYPE, perms);

        ofstream.init(this, mode, perms, 0);
        try {
            if (callable(buf))
                buf(ofstream.QueryInterface(Ci.nsIOutputStream));
            else {
                var ocstream = getStream(0);
                ocstream.writeString(buf);
            }
        }
        catch (e if callable(buf) && e.result == Cr.NS_ERROR_LOSS_OF_SIGNIFICANT_DATA) {
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
    }
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
    get PATH_SEP() {
        delete this.PATH_SEP;
        let f = services.get("directory").get("CurProcD", Ci.nsIFile);
        f.append("foo");
        return this.PATH_SEP = f.path.substr(f.parent.path.length, 1);
    },

    defaultEncoding: "UTF-8",

    expandPath: function (path, relative) {

        // expand any $ENV vars - this is naive but so is Vim and we like to be compatible
        // TODO: Vim does not expand variables set to an empty string (and documents it).
        // Kris reckons we shouldn't replicate this 'bug'. --djk
        // TODO: should we be doing this for all paths?
        function expand(path) path.replace(
            !win32 ? /\$(\w+)\b|\${(\w+)}/g
                   : /\$(\w+)\b|\${(\w+)}|%(\w+)%/g,
            function (m, n1, n2, n3) services.get("environment").get(n1 || n2 || n3) || m
        );
        path = expand(path);

        // expand ~
        // Yuck.
        if (!relative && RegExp("~(?:$|[/" + util.escapeRegex(File.PATH_SEP) + "])").test(path)) {
            // Try $HOME first, on all systems
            let home = services.get("environment").get("HOME");

            // Windows has its own idiosyncratic $HOME variables.
            if (win32 && (!home || !File(home) || !File(home).exists()))
                home = services.get("environment").get("USERPROFILE") ||
                       services.get("environment").get("HOMEDRIVE") + services.get("environment").get("HOMEPATH");

            path = home + path.substr(1);
        }

        // TODO: Vim expands paths twice, once before checking for ~, once
        // after, but doesn't document it. Is this just a bug? --Kris
        path = expand(path);
        return path.replace("/", File.PATH_SEP, "g");
    },

    expandPathList: function (list) list.map(this.expandPath),

    isAbsolutePath: function (path) {
        try {
            services.create("file").initWithPath(path);
            return true;
        }
        catch (e) {
            return false;
        }
    },

    joinPaths: function (head, tail, cwd) {
        let path = this(head, cwd);
        try {
            // FIXME: should only expand env vars and normalise path separators
            path.appendRelativePath(this.expandPath(tail, true));
        }
        catch (e) {
            return { exists: function () false, __noSuchMethod__: function () { throw e; } };
        }
        return path;
    },

    replacePathSep: function (path) path.replace("/", File.PATH_SEP, "g")
});

endModule();

// catch(e){dump(e.fileName+":"+e.lineNumber+": "+e+"\n" + e.stack);}

// vim: set fdm=marker sw=4 sts=4 et ft=javascript:
