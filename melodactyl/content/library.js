// Copyright (c) 2009 by Prathyush Thota <prathyushthota@gmail.com>
// Copyright (c) 2009 by Doug Kearns <dougkearns@gmail.com>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
"use strict";

// TODO: flesh this out
const Library = Module("library", {
    init: function () {
        this.MAIN_LIBRARY = LibraryUtils.mainLibrary;
    },

    /**
     * Converts an XPCOM enumerator to a JavaScript array.
     *
     * @param {nsISimpleEnumerator|nsIStringEnumerator|nsIArray} enum The enumerator to convert.
     * @returns {Array}
     */
    _toJSArray: function _toJSArray(enum) ArrayConverter.JSArray(enum),

    /**
     * Returns an array of all the artist names in the main library.
     *
     * @returns {[string]}
     */
    getArtists: function getArtists() this._toJSArray(this.MAIN_LIBRARY.getDistinctValuesForProperty(SBProperties.artistName)),

    // FIXME: Prathyush do we really want to remove duplicates? If so, why not tracks too? --djk
    /**
     * Returns an array of all the album names for *artist* in the main
     * library.
     *
     * @param {string} artist The artist's name.
     * @returns {[string]}
     */
    getAlbums: function getAlbums(artist) {
        let albums = this._toJSArray(this.MAIN_LIBRARY.getItemsByProperty(SBProperties.artistName, artist))
                         .map(track => track.getProperty(SBProperties.albumName));
        return array.uniq(albums);
    },

    /**
     * Returns an array of all the track names for *artist* and *album* in the
     * main library.
     *
     * @param {string} artist The artist's name.
     * @param {string} album The album's name.
     * @returns {[string]}
     */
    getTracks: function getTracks(artist, album) {
        let properties = services.MutablePropertyArray();

        properties.appendProperty(SBProperties.artistName, artist);
        properties.appendProperty(SBProperties.albumName, album);

        return this._toJSArray(this.MAIN_LIBRARY.getItemsByProperties(properties))
                   .map(track => track.getProperty(SBProperties.trackName));
    }
}, {
}, {
});

// vim: set fdm=marker sw=4 sts=4 ts=8 et:
