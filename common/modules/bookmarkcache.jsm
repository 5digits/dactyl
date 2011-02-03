// Copyright ©2008-2010 Kris Maglione <maglione.k at Gmail>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
"use strict";

Components.utils.import("resource://dactyl/bootstrap.jsm");
defineModule("bookmarkcache", {
    exports: ["Bookmark", "BookmarkCache", "Keyword", "bookmarkcache"],
    require: ["services", "storage", "util"]
}, this);

var Bookmark = Struct("url", "title", "icon", "post", "keyword", "tags", "charset", "id");
var Keyword = Struct("keyword", "title", "icon", "url");
Bookmark.defaultValue("icon", function () BookmarkCache.getFavicon(this.url));
update(Bookmark.prototype, {
    get extra() [
        ["keyword", this.keyword,         "Keyword"],
        ["tags",    this.tags.join(", "), "Tag"]
    ].filter(function (item) item[1]),

    get uri() util.newURI(this.url),

    encodeURIComponent: function _encodeURIComponent(str) {
        if (!this.charset || this.charset === "UTF-8")
            return encodeURIComponent(str);
        let conv = services.CharsetConv(this.charset);
        return escape(conv.ConvertFromUnicode(str) + conv.Finish());
    }
})
Bookmark.setter = function (key, func) this.prototype.__defineSetter__(key, func);
Bookmark.setter("url", function (val) {
    let tags = this.tags;
    this.tags = null;
    services.bookmarks.changeBookmarkURI(this.id, val);
    this.tags = tags;
});
Bookmark.setter("title", function (val) { services.bookmarks.setItemTitle(this.id, val); });
Bookmark.setter("post", function (val) { bookmarkcache.annotate(this.id, bookmarkcache.POST, val); });
Bookmark.setter("charset", function (val) { bookmarkcache.annotate(this.id, bookmarkcache.CHARSET, val); });
Bookmark.setter("keyword", function (val) { services.bookmarks.setKeywordForBookmark(this.id, val); });
Bookmark.setter("tags", function (val) {
    services.tagging.untagURI(this.uri, null);
    if (val)
        services.tagging.tagURI(this.uri, val);
});

var name = "bookmark-cache";

var BookmarkCache = Module("BookmarkCache", XPCOM(Ci.nsINavBookmarkObserver), {
    POST: "bookmarkProperties/POSTData",
    CHARSET: "dactyl/charset",

    init: function init() {
        services.bookmarks.addObserver(this, false);
    },

    cleanup: function cleanup() {
        services.bookmarks.removeObserver(this);
    },

    __iterator__: function () (val for ([, val] in Iterator(bookmarkcache.bookmarks))),

    get bookmarks() Class.replaceProperty(this, "bookmarks", this.load()),

    get keywords() array.toObject([[b.keyword, b] for (b in this) if (b.keyword)]),

    rootFolders: ["toolbarFolder", "bookmarksMenuFolder", "unfiledBookmarksFolder"]
        .map(function (s) services.bookmarks[s]),

    _deleteBookmark: function deleteBookmark(id) {
        let result = this.bookmarks[id] || null;
        delete this.bookmarks[id];
        return result;
    },

    _loadBookmark: function loadBookmark(node) {
        if (node.uri == null) // How does this happen?
            return false;
        let uri = util.newURI(node.uri);
        let keyword = services.bookmarks.getKeywordForBookmark(node.itemId);
        let tags = services.tagging.getTagsForURI(uri, {}) || [];
        let post = BookmarkCache.getAnnotation(node.itemId, this.POST);
        let charset = BookmarkCache.getAnnotation(node.itemId, this.CHARSET);
        return Bookmark(node.uri, node.title, node.icon && node.icon.spec, post, keyword, tags, charset, node.itemId);
    },

    annotate: function (id, key, val, timespan) {
        if (val)
            services.annotation.setItemAnnotation(id, key, val, 0,
                                                  timespan || services.annotation.EXPIRE_NEVER);
        else if (services.annotation.itemHasAnnotation(id, key))
            services.annotation.removeItemAnnotation(id, key);
    },

    get: function (url) {
        let ids = services.bookmarks.getBookmarkIdsForURI(util.newURI(url), {});
        for (let id in values(ids))
            if (id in this.bookmarks)
                return this.bookmarks[id];
        return null;
    },

    readBookmark: function readBookmark(id) ({
        itemId: id,
        uri:    services.bookmarks.getBookmarkURI(id).spec,
        title:  services.bookmarks.getItemTitle(id)
    }),

    findRoot: function findRoot(id) {
        do {
            var root = id;
            id = services.bookmarks.getFolderIdForItem(id);
        } while (id != services.bookmarks.placesRoot && id != root);
        return root;
    },

    isBookmark: function (id) this.rootFolders.indexOf(this.findRoot(id)) >= 0,

    /**
     * Returns true if the given URL is bookmarked and that bookmark is
     * not a Live Bookmark.
     *
     * @param {nsIURI|string} url The URL of which to check the bookmarked
     *     state.
     * @returns {boolean}
     */
    isBookmarked: function isBookmarked(uri) {
        if (isString(uri))
            uri = util.newURI(uri);

        try {
            return services.bookmarks
                           .getBookmarkIdsForURI(uri, {})
                           .some(this.closure.isRegularBookmark);
        }
        catch (e) {
            return false;
        }
    },

    isRegularBookmark: function isRegularBookmark(id) {
        do {
            var root = id;
            if (services.livemark && services.livemark.isLivemark(id))
                return false;
            id = services.bookmarks.getFolderIdForItem(id);
        } while (id != services.bookmarks.placesRoot && id != root);
        return this.rootFolders.indexOf(root) >= 0;
    },

    // Should be made thread safe.
    load: function load() {
        let bookmarks = {};

        let folders = this.rootFolders.slice();
        let query = services.history.getNewQuery();
        let options = services.history.getNewQueryOptions();
        while (folders.length > 0) {
            query.setFolders(folders, 1);
            folders.shift();
            let result = services.history.executeQuery(query, options);
            let folder = result.root;
            folder.containerOpen = true;

            // iterate over the immediate children of this folder
            for (let i = 0; i < folder.childCount; i++) {
                let node = folder.getChild(i);
                if (node.type == node.RESULT_TYPE_FOLDER)   // folder
                    folders.push(node.itemId);
                else if (node.type == node.RESULT_TYPE_URI) // bookmark
                    bookmarks[node.itemId] = this._loadBookmark(node);
            }

            // close a container after using it!
            folder.containerOpen = false;
        }

        return bookmarks;
    },

    onItemAdded: function onItemAdded(itemId, folder, index) {
        if (services.bookmarks.getItemType(itemId) == services.bookmarks.TYPE_BOOKMARK) {
            if (this.isBookmark(itemId)) {
                let bmark = this._loadBookmark(this.readBookmark(itemId));
                this.bookmarks[bmark.id] = bmark;
                storage.fireEvent(name, "add", bmark);
            }
        }
    },
    onItemRemoved: function onItemRemoved(itemId, folder, index) {
        let result = this._deleteBookmark(itemId);
        if (result)
            storage.fireEvent(name, "remove", result);
    },
    onItemChanged: function onItemChanged(itemId, property, isAnnotation, value) {
        if (isAnnotation)
            if (property === this.POST)
                [property, value] = ["post", BookmarkCache.getAnnotation(itemId, property)];
            else if (property === this.CHARSET)
                [property, value] = ["charset", BookmarkCache.getAnnotation(itemId, property)];
            else
                return;

        let bookmark = this.bookmarks[itemId];
        if (bookmark) {
            if (property == "tags")
                value = services.tagging.getTagsForURI(bookmark.uri, {});
            if (property in bookmark) {
                bookmark[bookmark.members[property]] = value;
                storage.fireEvent(name, "change", { __proto__: bookmark, changed: property });
            }
        }
    }
}, {
    getAnnotation: function getAnnotation(item, anno)
        services.annotation.itemHasAnnotation(item, anno) ?
        services.annotation.getItemAnnotation(item, anno) : null,
    getFavicon: function getFavicon(uri) {
        try {
            return services.favicon.getFaviconImageForPage(util.newURI(uri)).spec;
        }
        catch (e) {
            return "";
        }
    }
});

endModule();

// vim: set fdm=marker sw=4 sts=4 et ft=javascript:
