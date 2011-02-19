// Copyright (c) 2008-2011 by Kris Maglione <maglione.k at Gmail>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
"use strict";

Components.utils.import("resource://dactyl/bootstrap.jsm");
defineModule("storage", {
    exports: ["File", "storage"],
    require: ["services", "util"]
}, this);

var win32 = /^win(32|nt)$/i.test(services.runtime.OS);
var myObject = JSON.parse("{}").constructor;

function loadData(name, store, type) {
    try {
        let data = storage.infoPath.child(name).read();
        let result = JSON.parse(data);
        if (result instanceof type)
            return result;
    }
    catch (e) {}
}

function saveData(obj) {
    if (obj.privateData && storage.privateMode)
        return;
    if (obj.store && storage.infoPath)
        storage.infoPath.child(obj.name).write(obj.serial);
}

var StoreBase = Class("StoreBase", {
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

    changed: function () { this.timer.tell(); },

    reload: function reload() {
        this._object = this._load() || this._constructor();
        this.fireEvent("change", null);
    },

    delete: function delete_() {
        delete storage.keys[this.name];
        delete storage[this.name];
        storage.infoPath.child(this.name).remove(false);
    },

    save: function () { saveData(this); },

    __iterator__: function () Iterator(this._object)
});

var ArrayStore = Class("ArrayStore", StoreBase, {
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

    get: function get(index) index >= 0 ? this._object[index] : this._object[this._object.length + index]
});

var ObjectStore = Class("ObjectStore", StoreBase, {
    _constructor: myObject,

    clear: function () {
        this._object = {};
        this.fireEvent("clear");
    },

    get: function get(key, default_) {
        return key in this._object  ? this._object[key] :
               arguments.length > 1 ? this.set(key, default_) :
                                      undefined;
    },

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
    }
});

var Storage = Module("Storage", {
    alwaysReload: {},

    init: function () {
        this.cleanup();
    },

    cleanup: function () {
        this.saveAll();

        for (let key in keys(this.keys)) {
            if (this[key].timer)
                this[key].timer.flush();
            delete this[key];
        }
        for (let ary in values(this.observers))
            for (let obj in values(ary))
                if (obj.ref && obj.ref.get())
                    delete obj.ref.get().dactylStorageRefs;

        this.keys = {};
        this.observers = {};
    },

    exists: function exists(name) this.infoPath.child(name).exists(),

    newObject: function newObject(key, constructor, params) {
        if (params == null || !isObject(params))
            throw Error("Invalid argument type");

        if (!(key in this.keys) || params.reload || this.alwaysReload[key]) {
            if (key in this && !(params.reload || this.alwaysReload[key]))
                throw Error();
            let load = function () loadData(key, params.store, params.type || myObject);

            this.keys[key] = new constructor(key, params.store, load, params);
            this.keys[key].timer = new Timer(1000, 10000, function () storage.save(key));
            this.__defineGetter__(key, function () this.keys[key]);
        }
        return this.keys[key];
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
        if (!(key in this.observers))
            this.observers[key] = [];
        if (!this.observers[key].some(function (o) o.callback.get() == callback))
            this.observers[key].push({ ref: ref && Cu.getWeakReference(ref), callback: callbackRef });
    },

    removeObserver: function (key, callback) {
        this.removeDeadObservers();
        if (!(key in this.observers))
            return;
        this.observers[key] = this.observers[key].filter(function (elem) elem.callback.get() != callback);
        if (this.observers[key].length == 0)
            delete obsevers[key];
    },

    removeDeadObservers: function () {
        for (let [key, ary] in Iterator(this.observers)) {
            this.observers[key] = ary = ary.filter(function (o) o.callback.get() && (!o.ref || o.ref.get() && o.ref.get().dactylStorageRefs));
            if (!ary.length)
                delete this.observers[key];
        }
    },

    fireEvent: function fireEvent(key, event, arg) {
        this.removeDeadObservers();
        if (key in this.observers)
            // Safe, since we have our own Array object here.
            for each (let observer in this.observers[key])
                observer.callback.get()(key, event, arg);
        if (key in this.keys)
            this[key].timer.tell();
    },

    load: function load(key) {
        if (this[key].store && this[key].reload)
            this[key].reload();
    },

    save: function save(key) {
        if (this[key])
            saveData(this.keys[key]);
    },

    saveAll: function storeAll() {
        for each (let obj in this.keys)
            saveData(obj);
    },

    _privateMode: false,
    get privateMode() this._privateMode,
    set privateMode(val) {
        if (val && !this._privateMode)
            this.saveAll();
        if (!val && this._privateMode)
            for (let key in this.keys)
                this.load(key);
        return this._privateMode = Boolean(val);
    }
}, {
    Replacer: {
        skipXpcom: function skipXpcom(key, val) val instanceof Ci.nsISupports ? null : val
    }
}, {
    init: function init(dactyl, modules) {
        init.superapply(this, arguments);
        storage.infoPath = File(modules.IO.runtimePath.replace(/,.*/, ""))
                             .child("info").child(dactyl.profileName);
    },

    cleanup: function (dactyl, modules, window) {
        delete window.dactylStorageRefs;
        this.removeDeadObservers();
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
var File = Class("File", {
    init: function (path, checkPWD) {
        let file = services.File();

        if (path instanceof Ci.nsIFile)
            file = path.QueryInterface(Ci.nsIFile).clone();
        else if (/file:\/\//.test(path))
            file = services["file:"]().getFileFromURLSpec(path);
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
        let self = XPCSafeJSObjectWrapper(file.QueryInterface(Ci.nsILocalFile));
        self.__proto__ = this;
        return self;
    },

    /**
     * Iterates over the objects in this directory.
     */
    iterDirectory: function () {
        if (!this.exists())
            throw Error("File does not exist");
        if (!this.isDirectory())
            throw Error("Not a directory");
        for (let file in iter(this.directoryEntries))
            yield File(file);
    },

    /**
     * Returns a new file for the given child of this directory entry.
     */
    child: function (name) {
        let f = this.constructor(this);
        for each (let elem in name.split(File.pathSplit))
            f.append(elem);
        return f;
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

        return File.readStream(ifstream, encoding);
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
     * Returns a new nsIFileURL object for this file.
     *
     * @returns {nsIFileURL}
     */
    toURI: function toURI() services.io.newFileURI(this),

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
            perms = octal(644);
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
    PATH_SEP: Class.memoize(function () {
        let f = services.directory.get("CurProcD", Ci.nsIFile);
        f.append("foo");
        return f.path.substr(f.parent.path.length, 1);
    }),

    pathSplit: Class.memoize(function () util.regexp("(?:/|" + util.regexp.escape(this.PATH_SEP) + ")", "g")),

    DoesNotExist: function (path, error) ({
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
    expandPath: function (path, relative) {
        function getenv(name) services.environment.get(name);

        // expand any $ENV vars - this is naive but so is Vim and we like to be compatible
        // TODO: Vim does not expand variables set to an empty string (and documents it).
        // Kris reckons we shouldn't replicate this 'bug'. --djk
        // TODO: should we be doing this for all paths?
        function expand(path) path.replace(
            !win32 ? /\$(\w+)\b|\${(\w+)}/g
                   : /\$(\w+)\b|\${(\w+)}|%(\w+)%/g,
            function (m, n1, n2, n3) getenv(n1 || n2 || n3) || m
        );
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

    readStream: function (ifstream, encoding) {
        try {
            var icstream = Cc["@mozilla.org/intl/converter-input-stream;1"].createInstance(Ci.nsIConverterInputStream);
            icstream.init(ifstream, encoding || File.defaultEncoding, 4096, // 4096 bytes buffering
                          Ci.nsIConverterInputStream.DEFAULT_REPLACEMENT_CHARACTER);
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

    isAbsolutePath: function (path) {
        try {
            services.File().initWithPath(path);
            return true;
        }
        catch (e) {
            return false;
        }
    },

    joinPaths: function (head, tail, cwd) {
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

endModule();

// catch(e){dump(e.fileName+":"+e.lineNumber+": "+e+"\n" + e.stack);}

// vim: set fdm=marker sw=4 sts=4 et ft=javascript:
