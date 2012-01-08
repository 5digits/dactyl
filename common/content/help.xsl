<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE stylesheet SYSTEM "dactyl://content/dtd">

<!-- Header {{{1 -->
<xsl:stylesheet version="1.0"
    xmlns="http://www.w3.org/1999/xhtml"
    xmlns:html="http://www.w3.org/1999/xhtml"
    xmlns:dactyl="http://vimperator.org/namespaces/liberator"
    xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
    xmlns:exsl="http://exslt.org/common"
    xmlns:regexp="http://exslt.org/regular-expressions"
    xmlns:str="http://exslt.org/strings"
    extension-element-prefixes="exsl regexp str">

    <xsl:output method="xml" indent="no"/>

    <!-- Variable Definitions {{{1 -->


    <!-- Process Overlays {{{1 -->

    <xsl:template name="splice-overlays">
        <xsl:param name="elem"/>
        <xsl:param name="tag"/>
        <xsl:for-each select="ancestor::*/dactyl:overlay/*[@insertbefore=$tag]">
            <xsl:apply-templates select="." mode="overlay"/>
        </xsl:for-each>
        <xsl:choose>
            <xsl:when test="ancestor::*/dactyl:overlay/*[@replace=$tag] and not($elem[@replace])">
                <xsl:for-each select="ancestor::*/dactyl:overlay/*[@replace=$tag]">
                    <xsl:apply-templates select="." mode="overlay-2"/>
                </xsl:for-each>
            </xsl:when>
            <xsl:otherwise>
                <xsl:for-each select="$elem">
                    <xsl:apply-templates select="." mode="overlay-2"/>
                </xsl:for-each>
            </xsl:otherwise>
        </xsl:choose>
        <xsl:for-each select="ancestor::*/dactyl:overlay/*[@insertafter=$tag]">
            <xsl:apply-templates select="." mode="overlay"/>
        </xsl:for-each>
    </xsl:template>

    <xsl:template match="dactyl:tags[parent::dactyl:document]|dactyl:tag" mode="overlay">
        <xsl:call-template name="splice-overlays">
            <xsl:with-param name="tag" select="substring-before(concat(., ' '), ' ')"/>
            <xsl:with-param name="elem" select="self::node()"/>
        </xsl:call-template>
    </xsl:template>
    <xsl:template match="*[dactyl:tags]" mode="overlay">
        <xsl:call-template name="splice-overlays">
            <xsl:with-param name="tag" select="substring-before(concat(dactyl:tags, ' '), ' ')"/>
            <xsl:with-param name="elem" select="self::node()"/>
        </xsl:call-template>
    </xsl:template>
    <xsl:template match="dactyl:*[@tag and not(@replace)]" mode="overlay">
        <xsl:call-template name="splice-overlays">
            <xsl:with-param name="tag" select="substring-before(concat(@tag, ' '), ' ')"/>
            <xsl:with-param name="elem" select="self::node()"/>
        </xsl:call-template>
    </xsl:template>

    <!-- Process Inclusions {{{1 -->

    <xsl:template name="include">
        <xsl:param name="root-node" select="."/>
        <xsl:param name="overlay" select="concat('dactyl://help-overlay/', $root-node/@name)"/>

        <!-- Ridiculous three-pass processing is needed to deal with
           - lack of dynamic variable scope in XSL 1.0.  -->

        <!-- Store a copy of the overlay for the current document. -->
        <xsl:variable name="doc">
            <dactyl:document>
                <xsl:copy-of select="document($overlay)/dactyl:overlay"/>
                <xsl:copy-of select="$root-node/node()"/>
            </dactyl:document>
        </xsl:variable>

        <xsl:call-template name="parse-tags">
            <xsl:with-param name="text" select="concat($root-node/@name, '.xml')"/>
        </xsl:call-template>
        <xsl:apply-templates select="exsl:node-set($doc)/dactyl:document/node()[position() != 1]" mode="overlay"/>
    </xsl:template>

    <xsl:template match="dactyl:include" mode="overlay-2">
        <div dactyl:highlight="HelpInclude">
            <xsl:call-template name="include">
                <xsl:with-param name="root-node" select="document(@href)/dactyl:document"/>
            </xsl:call-template>
        </div>
    </xsl:template>

    <xsl:template match="@*|node()" mode="overlay">
        <xsl:apply-templates select="." mode="overlay-2"/>
    </xsl:template>
    <xsl:template match="@*[starts-with(local-name(), 'on')]|*[local-name() = 'script']" mode="overlay-2"/>
    <xsl:template match="@*|node()" mode="overlay-2">
        <xsl:copy>
            <xsl:apply-templates select="@*|node()" mode="overlay"/>
        </xsl:copy>
    </xsl:template>

    <!-- Root {{{1 -->

    <xsl:template match="/">

        <!-- Ridiculous three-pass processing is needed to deal with
           - lack of dynamic variable scope in XSL 1.0.  -->

        <xsl:variable name="doc1">
            <xsl:call-template name="include">
                <xsl:with-param name="root-node" select="dactyl:document"/>
            </xsl:call-template>
        </xsl:variable>
        <xsl:variable name="root" select="exsl:node-set($doc1)"/>

        <!-- Store a cache of all tags defined -->
        <xsl:variable name="doc2">
            <dactyl:document>
                <xsl:attribute name="document-tags">
                    <xsl:text> </xsl:text>
                    <xsl:for-each select="$root//@tag|$root//dactyl:tags/text()|$root//dactyl:tag/text()">
                        <xsl:value-of select="concat(., ' ')"/>
                    </xsl:for-each>
                </xsl:attribute>
                <xsl:copy-of select="$root/node()"/>
            </dactyl:document>
        </xsl:variable>
        <xsl:variable name="root2" select="exsl:node-set($doc2)/dactyl:document"/>

        <html dactyl:highlight="Help">
            <head>
                <title><xsl:value-of select="/dactyl:document/@title"/></title>
                <script type="text/javascript" src="resource://dactyl-content/help.js"/>
            </head>
            <body dactyl:highlight="HelpBody">
                <xsl:apply-templates select="$root2/node()|$root2/@*" mode="help-1"/>
            </body>
        </html>
    </xsl:template>

    <!-- Table of Contents {{{1 -->

    <xsl:template name="toc">
        <xsl:param name="level" select="1"/>
        <xsl:param name="context"/>
        <xsl:param name="toc"/>

        <xsl:variable name="tag" select="concat('h', $level)"/>
        <xsl:variable name="lasttag" select="concat('h', $level - 1)"/>

        <xsl:variable name="nodes" select="$toc/*[
            local-name() = $tag and not(preceding::*[local-name() = $lasttag][position() = 1 and not(.=$context)])]"/>

        <xsl:if test="$nodes">
            <ol level="{$level}" dactyl:highlight="HelpOrderedList">
                <xsl:for-each select="$nodes">
                    <li>
                        <a>
                            <xsl:if test="@tag">
                                <xsl:attribute name="href"><xsl:value-of select="concat('#', substring-before(concat(@tag, ' '), ' '))"/></xsl:attribute>
                            </xsl:if>
                            <xsl:apply-templates select="node()[not(self::dactyl:strut)]" mode="help-1"/>
                        </a>
                        <xsl:call-template name="toc">
                            <xsl:with-param name="level" select="$level + 1"/>
                            <xsl:with-param name="context" select="."/>
                            <xsl:with-param name="toc" select="$toc"/>
                        </xsl:call-template>
                    </li>
                </xsl:for-each>
            </ol>
        </xsl:if>
    </xsl:template>
    <xsl:template match="dactyl:toc" mode="help-2">
        <xsl:variable name="TOC">
            <context/>
            <xsl:for-each
                select="following::dactyl:h1|following::dactyl:h2|following::dactyl:h3|following::dactyl:h4|following::dactyl:h5">
                <xsl:copy-of select="."/>
            </xsl:for-each>
        </xsl:variable>
        <xsl:variable name="toc" select="exsl:node-set($TOC)"/>

        <xsl:if test="//dactyl:toc[1 and self::*]">
            <div dactyl:highlight="HelpTOC">
                <h2><!--L-->Contents</h2>
                <xsl:if test="@start">
                    <xsl:call-template name="toc">
                        <xsl:with-param name="level" select="number(@start)"/>
                        <xsl:with-param name="toc" select="$toc"/>
                    </xsl:call-template>
                </xsl:if>
                <xsl:if test="not(@start)">
                    <xsl:call-template name="toc">
                        <xsl:with-param name="toc" select="$toc"/>
                    </xsl:call-template>
                </xsl:if>
            </div>
        </xsl:if>
    </xsl:template>

    <!-- Items {{{1 -->

    <xsl:template match="dactyl:strut" mode="help-2">
        <div style="clear: both"/>
    </xsl:template>
    <xsl:template match="dactyl:item" mode="help-2">
        <div dactyl:highlight="HelpItem">
            <xsl:apply-templates select="dactyl:tags|dactyl:spec|dactyl:strut" mode="help-1"/>
            <xsl:if test="not(dactyl:description/@short)">
                <hr style="border: 0; height: 0; margin: 0; width: 100%; float: right;"/>
                <xsl:if test="dactyl:type|dactyl:default">
                    <div dactyl:highlight="HelpOptInfo">
                        <xsl:apply-templates select="dactyl:type|dactyl:default" mode="help-1"/>
                        <div style="clear: both;"/>
                    </div>
                </xsl:if>
            </xsl:if>
            <xsl:apply-templates select="dactyl:description" mode="help-1"/>
            <div style="clear: both;"/>
        </div>
    </xsl:template>
    <!--
    <xsl:template match="dactyl:item/dactyl:spec[position() = last()]" mode="help-2">
        <div style="clear: both;"/>
        <div dactyl:highlight="HelpSpec"><xsl:apply-templates mode="help-1"/></div>
    </xsl:template>
    -->

    <xsl:template match="dactyl:default[not(@type='plain')]" mode="help-2">
        <xsl:variable name="type" select="preceding-sibling::dactyl:type[1] | following-sibling::dactyl:type[1]"/>
        <span dactyl:highlight="HelpDefault">
            <xsl:copy-of select="@*[not(starts-with(local-name(), 'on'))]"/>
            <xsl:text>(default: </xsl:text>
            <xsl:choose>
                <xsl:when test="$type = 'string'">
                    <span dactyl:highlight="HelpString" delim="'"><xsl:apply-templates mode="help-1"/></span>
                </xsl:when>
                <xsl:when test="contains($type, 'list') or contains($type, 'map')">
                    <span dactyl:highlight="HelpString" delim=""><xsl:apply-templates mode="help-1"/></span>
                    <xsl:if test=". = ''"><!--L-->(empty)</xsl:if>
                </xsl:when>
                <xsl:otherwise>
                    <span>
                        <xsl:attribute name="dactyl:highlight">
                            <xsl:choose>
                                <xsl:when test="$type = 'boolean'">Boolean</xsl:when>
                                <xsl:when test="$type = 'number'">Number</xsl:when>
                                <xsl:when test="$type = 'charlist'">String</xsl:when>
                            </xsl:choose>
                        </xsl:attribute>
                        <xsl:apply-templates select="node()" mode="help-1"/>
                    </span>
                </xsl:otherwise>
            </xsl:choose>)</span>
    </xsl:template>

    <!-- Tag Definitions {{{1 -->

    <xsl:template match="dactyl:item/dactyl:tags[position() = last()]" mode="help-2">
        <div style="clear: right"/>
        <xsl:call-template name="parse-tags">
            <xsl:with-param name="text" select="."/>
        </xsl:call-template>
    </xsl:template>
    <xsl:template match="dactyl:tags" mode="help-2">
        <xsl:call-template name="parse-tags">
            <xsl:with-param name="text" select="."/>
        </xsl:call-template>
    </xsl:template>
    <xsl:template match="@tag[parent::dactyl:p]" mode="help-2">
        <xsl:call-template name="parse-tags">
            <xsl:with-param name="text" select="."/>
        </xsl:call-template>
        <div style="clear: right"/>
    </xsl:template>
    <xsl:template match="dactyl:tag|@tag" mode="help-2">
        <xsl:call-template name="parse-tags">
            <xsl:with-param name="text" select="."/>
        </xsl:call-template>
    </xsl:template>
    <xsl:template name="parse-tags">
        <xsl:param name="text"/>
        <div dactyl:highlight="HelpTags">
        <xsl:for-each select="str:tokenize($text)">
            <a id="{.}" dactyl:highlight="HelpTag"><xsl:value-of select="."/></a>
        </xsl:for-each>
        </div>
    </xsl:template>

    <!-- Tag Links {{{1 -->

    <xsl:template name="linkify-tag">
        <xsl:param name="contents" select="text()"/>
        <xsl:variable name="tag" select="$contents"/>
        <xsl:variable name="tag-url" select="
          regexp:replace(regexp:replace(regexp:replace($tag, '%', 'g', '%25'),
                                        '#', 'g', '%23'),
                         ';', 'g', '%3B')"/>

        <a style="color: inherit;">
            <xsl:if test="not(@link) or @link != 'false'">
                <xsl:choose>
                    <xsl:when test="@link and @link != 'false'">
                        <xsl:attribute name="href">dactyl://help-tag/<xsl:value-of select="@link"/></xsl:attribute>
                    </xsl:when>
                    <xsl:when test="contains(ancestor::*/@document-tags, concat(' ', $tag, ' '))">
                        <xsl:attribute name="href">#<xsl:value-of select="$tag-url"/></xsl:attribute>
                    </xsl:when>
                    <xsl:otherwise>
                        <xsl:attribute name="href">dactyl://help-tag/<xsl:value-of select="$tag-url"/></xsl:attribute>
                    </xsl:otherwise>
                </xsl:choose>
            </xsl:if>
            <xsl:value-of select="$contents"/>
        </a>
    </xsl:template>

    <xsl:template match="dactyl:o" mode="help-2">
        <span dactyl:highlight="HelpOpt">
            <xsl:call-template name="linkify-tag">
                <xsl:with-param name="contents" select='concat("&#39;", text(), "&#39;")'/>
            </xsl:call-template>
        </span>
    </xsl:template>
    <xsl:template match="dactyl:pref" mode="help-2">
        <a href="http://kb.mozillazine.org/{text()}" dactyl:highlight="HelpOpt"
            >'<xsl:apply-templates select="@*|node()" mode="help-1"/>'</a>
    </xsl:template>
    <xsl:template match="dactyl:t" mode="help-2">
        <span dactyl:highlight="HelpTopic">
            <xsl:call-template name="linkify-tag"/>
        </span>
    </xsl:template>
    <xsl:template match="dactyl:k" mode="help-2">
        <span dactyl:highlight="HelpKey">
            <xsl:call-template name="linkify-tag"/>
        </span>
    </xsl:template>
    <xsl:template match="dactyl:kwd" mode="help-2">
        <span dactyl:highlight="HelpKeyword">
            <xsl:apply-templates select="@*|node()" mode="help-1"/>
        </span>
    </xsl:template>
    <xsl:template match="dactyl:k[@name]" mode="help-2">
        <span dactyl:highlight="HelpKey">
            <xsl:call-template name="linkify-tag">
                <xsl:with-param name="contents" select="concat('&lt;', @name, '>', .)"/>
            </xsl:call-template>
        </span>
    </xsl:template>
    <xsl:template match="dactyl:k[@mode]" mode="help-2">
        <span dactyl:highlight="HelpKey">
            <xsl:call-template name="linkify-tag">
                <xsl:with-param name="contents" select="concat(@mode, '_', text())"/>
            </xsl:call-template>
        </span>
    </xsl:template>
    <xsl:template match="dactyl:k[@mode and @name]" mode="help-2">
        <span dactyl:highlight="HelpKey">
            <xsl:call-template name="linkify-tag">
                <xsl:with-param name="contents" select="concat(@mode, '_', '&lt;', @name, '>', .)"/>
            </xsl:call-template>
        </span>
    </xsl:template>

    <!-- HTML-ish elements {{{1 -->

    <xsl:template match="dactyl:dl" mode="help-2">
        <xsl:apply-templates select="@tag" mode="help-1"/>
        <dl>
            <column style="{@dt}"/>
            <column style="{@dd}"/>
            <xsl:for-each select="dactyl:dt">
                <tr>
                    <xsl:apply-templates select="." mode="help-1"/>
                    <xsl:apply-templates select="following-sibling::dactyl:dd[1]" mode="help-1"/>
                </tr>
            </xsl:for-each>
        </dl>
    </xsl:template>

    <xsl:template match="dactyl:link" mode="help-2">
        <a>
            <xsl:choose>
                <xsl:when test="not(@topic)"/>
                <xsl:when test="regexp:match(@topic, '^([a-zA-Z]+:|[^/]*#|/)', '')">
                    <xsl:attribute name="href"><xsl:value-of select="@topic"/></xsl:attribute>
                </xsl:when>
                <xsl:otherwise>
                    <xsl:attribute name="href"><xsl:value-of select="concat('dactyl://help-tag/', @topic)"/></xsl:attribute>
                </xsl:otherwise>
            </xsl:choose>
            <xsl:if test="regexp:match(@topic, '^[a-zA-Z]+:', '')
                    and not(starts-with(@topic, 'mailto:') or
                            starts-with(@topic, 'chrome:') or
                            starts-with(@topic, 'resource:') or
                            starts-with(@topic, 'dactyl:'))">
                    <!-- A regexp does not work for the second test here ↑. :( -->
                <xsl:attribute name="rel">external</xsl:attribute>
            </xsl:if>
            <xsl:apply-templates select="@*|node()" mode="help-1"/>
        </a>
    </xsl:template>

    <xsl:template match="dactyl:hl" mode="help-2">
        <span dactyl:highlight="{@key}"><xsl:apply-templates select="@*|node()" mode="help-1"/></span>
    </xsl:template>
    <xsl:template match="dactyl:h" mode="help-2">
        <em><xsl:apply-templates select="@*|node()" mode="help-1"/></em>
    </xsl:template>
    <xsl:template match="dactyl:em | dactyl:tt | dactyl:p  |
                         dactyl:dt | dactyl:dd |
                         dactyl:ol | dactyl:ul | dactyl:li |
                         dactyl:h1 | dactyl:h2 | dactyl:h3 |
                         dactyl:h4"
                  mode="help-2">
        <xsl:element name="{local-name()}">
            <xsl:apply-templates select="@*|node()" mode="help-1"/>
        </xsl:element>
    </xsl:template>

    <xsl:template match="dactyl:code" mode="help-2">
        <pre dactyl:highlight="HelpCode"><xsl:apply-templates select="@*|node()" mode="help-1"/></pre>
    </xsl:template>

    <!-- Help elements {{{1 -->

    <xsl:template match="dactyl:a" mode="help-2">
        <span dactyl:highlight="HelpArg">{<xsl:apply-templates select="@*|node()" mode="help-1"/>}</span>
    </xsl:template>
    <xsl:template match="dactyl:oa" mode="help-2">
        <span dactyl:highlight="HelpOptionalArg">[<xsl:apply-templates select="@*|node()" mode="help-1"/>]</span>
    </xsl:template>

    <xsl:template match="dactyl:deprecated" mode="help-2">
        <p style="clear: both;">
            <xsl:apply-templates select="@*" mode="help-1"/>
            <span dactyl:highlight="HelpWarning"><!--L-->Deprecated:</span>
            <xsl:text> </xsl:text>
            <xsl:apply-templates select="node()" mode="help-1"/>
        </p>
    </xsl:template>
    <xsl:template match="dactyl:note" mode="help-2">
        <p style="clear: both;">
            <xsl:apply-templates select="@*" mode="help-1"/>
            <div style="clear: both;"/>
            <span dactyl:highlight="HelpNote"><!--L-->Note:</span>
            <xsl:text> </xsl:text>
            <xsl:apply-templates select="node()" mode="help-1"/>
        </p>
    </xsl:template>
    <xsl:template match="dactyl:warning" mode="help-2">
        <p style="clear: both;">
            <xsl:apply-templates select="@*" mode="help-1"/>
            <div style="clear: both;"/>
            <span dactyl:highlight="HelpWarning"><!--L-->Warning:</span>
            <xsl:text> </xsl:text>
            <xsl:apply-templates select="node()" mode="help-1"/>
        </p>
    </xsl:template>
    <xsl:template match="dactyl:default" mode="help-2">
        <span dactyl:highlight="HelpDefault">(default:<xsl:text> </xsl:text><xsl:apply-templates select="@*|node()" mode="help-1"/>)</span>
    </xsl:template>

    <!-- HTML-ify other elements {{{1 -->

    <xsl:template match="dactyl:ex" mode="help-2">
        <span dactyl:highlight="HelpEx">
            <xsl:variable name="tag" select="str:tokenize(text(), ' [!')[1]"/>
            <a href="dactyl://help-tag/{$tag}" style="color: inherit;">
                <xsl:if test="contains(ancestor::*/@document-tags, concat(' ', $tag, ' '))">
                    <xsl:attribute name="href">#<xsl:value-of select="$tag"/></xsl:attribute>
                </xsl:if>
                <xsl:apply-templates mode="help-1"/>
            </a>
        </span>
    </xsl:template>

    <xsl:template match="dactyl:se" mode="help-2">
        <xsl:variable name="nodes" xmlns="&xmlns.dactyl;">
            <html:span style="display: inline-block;">
                <ex>:set</ex>
                <xsl:text> </xsl:text>
                <link>
                    <xsl:if test="@link != 'false'">
                        <xsl:attribute name="topic">'<xsl:value-of select="@opt"/>'</xsl:attribute>
                    </xsl:if>
                    <hl key="HelpOpt"><xsl:value-of select="@opt"/></hl>
                </link>
                <xsl:choose>
                    <xsl:when test="@op and @op != ''"><xsl:value-of select="@op"/></xsl:when>
                    <xsl:otherwise>=</xsl:otherwise>
                </xsl:choose>
                <xsl:copy-of select="@*[not(starts-with(local-name(), 'on'))]|node()[local-name() != 'script']"/>
            </html:span>
        </xsl:variable>
        <xsl:apply-templates select="exsl:node-set($nodes)" mode="help-1"/>
    </xsl:template>

    <xsl:template match="dactyl:set" mode="help-2">
        <xsl:variable name="nodes">
            <code xmlns="&xmlns.dactyl;">
                <se opt="{@opt}" op="{@op}" link="{@link}">
                    <xsl:copy-of select="@*[not(starts-with(local-name(), 'on'))]|node()[local-name() != 'script']"/>
                </se>
            </code>
        </xsl:variable>
        <xsl:apply-templates select="exsl:node-set($nodes)" mode="help-1"/>
    </xsl:template>

    <xsl:template match="dactyl:description | dactyl:example | dactyl:spec" mode="help-2">
        <div>
            <xsl:if test="self::dactyl:description"><xsl:attribute name="dactyl:highlight">HelpDescription</xsl:attribute></xsl:if>
            <xsl:if test="self::dactyl:example"><xsl:attribute name="dactyl:highlight">HelpExample</xsl:attribute></xsl:if>
            <xsl:if test="self::dactyl:spec"><xsl:attribute name="dactyl:highlight">HelpSpec</xsl:attribute></xsl:if>
            <xsl:apply-templates select="@*|node()" mode="help-1"/>
        </div>
    </xsl:template>
    <xsl:template match="dactyl:type" mode="help-2">
        <a dactyl:highlight="HelpType">
            <xsl:choose>
                <xsl:when test="contains(ancestor::*/@document-tags, concat(' ', ., ' '))">
                    <xsl:attribute name="href">#<xsl:value-of select="."/></xsl:attribute>
                </xsl:when>
                <xsl:when test="not(. = 'boolean' or . = 'number' or . = 'string')">
                    <xsl:attribute name="href">dactyl://help-tag/<xsl:value-of select="."/></xsl:attribute>
                </xsl:when>
            </xsl:choose>
            <xsl:apply-templates select="@*|node()" mode="help-1"/>
        </a>
    </xsl:template>
    <xsl:template match="dactyl:str" mode="help-2">
        <span dactyl:highlight="HelpString">
            <xsl:apply-templates select="@*|node()" mode="help-1"/>
        </span>
    </xsl:template>
    <xsl:template match="dactyl:xml-block" mode="help-2">
        <div dactyl:highlight="HelpXMLBlock">
            <xsl:apply-templates mode="xml-highlight"/>
        </div>
    </xsl:template>
    <xsl:template match="dactyl:xml-highlight" mode="help-2">
        <div dactyl:highlight="HelpXMLBlock">
            <xsl:apply-templates mode="xml-highlight"/>
        </div>
    </xsl:template>


    <!-- Plugins {{{1 -->

    <xsl:template name="info">
        <xsl:param name="label"/>
        <xsl:param name="link" select="@href"/>
        <xsl:param name="nodes" select="node()"/>
        <xsl:param name="extra"/>
        <div dactyl:highlight="HelpInfo">
            <div dactyl:highlight="HelpInfoLabel">
                <xsl:value-of select="$label"/>:
            </div>
            <span dactyl:highlight="HelpInfoValue">
                <a>
                    <xsl:if test="$link">
                        <xsl:attribute name="href"><xsl:value-of select="$link"/></xsl:attribute>
                    </xsl:if>
                    <xsl:copy-of select="exsl:node-set($nodes)"/>
                </a>
                <xsl:copy-of select="exsl:node-set($extra)"/>
            </span>
        </div>
    </xsl:template>
    <xsl:template match="dactyl:author[@email]" mode="help-2">
        <xsl:call-template name="info">
            <xsl:with-param name="label" select="'Author'"/>
            <xsl:with-param name="extra">
                <xsl:text> </xsl:text><a href="mailto:{@email}"></a>
            </xsl:with-param>
        </xsl:call-template>
    </xsl:template>
    <xsl:template match="dactyl:author" mode="help-2">
        <xsl:call-template name="info">
            <xsl:with-param name="label" select="'Author'"/>
        </xsl:call-template>
    </xsl:template>
    <xsl:template match="dactyl:license" mode="help-2">
        <xsl:call-template name="info">
            <xsl:with-param name="label" select="'License'"/>
        </xsl:call-template>
    </xsl:template>
    <xsl:template match="dactyl:plugin" mode="help-2">
        <xsl:call-template name="info">
            <xsl:with-param name="label" select="'Plugin'"/>
            <xsl:with-param name="nodes">
                <span><xsl:value-of select="@name"/></span>
            </xsl:with-param>
        </xsl:call-template>
        <xsl:if test="@version">
            <xsl:call-template name="info">
                <xsl:with-param name="label" select="'Version'"/>
                <xsl:with-param name="link" select="''"/>
                <xsl:with-param name="nodes">
                    <span><xsl:value-of select="@version"/></span>
                </xsl:with-param>
            </xsl:call-template>
        </xsl:if>
        <xsl:apply-templates mode="help-1"/>
    </xsl:template>

    <!-- Special Element Templates {{{1 -->

    <xsl:template match="dactyl:logo" mode="help-1">
        <span dactyl:highlight="Logo"/>
    </xsl:template>

    <!-- Process Tree {{{1 -->

    <xsl:template match="@*[starts-with(local-name(), 'on')]|*[local-name() = 'script']" mode="help-2"/>
    <xsl:template match="@*|node()" mode="help-2">
        <xsl:copy>
            <xsl:apply-templates select="@*|node()" mode="help-1"/>
        </xsl:copy>
    </xsl:template>
    <xsl:template match="@*|node()" mode="help-1">
        <xsl:apply-templates select="." mode="help-2"/>
    </xsl:template>

    <!-- XML Highlighting (xsl:import doesn't work in Firefox 3.x) {{{1 -->
    <xsl:template name="xml-namespace">
        <xsl:param name="node" select="."/>
        <xsl:if test="name($node) != local-name($node)">
            <span dactyl:highlight="HelpXMLNamespace">
                <xsl:value-of select="substring-before(name($node), ':')"/>
            </span>
        </xsl:if>
        <xsl:value-of select="local-name($node)"/>
    </xsl:template>

    <xsl:template match="*" mode="xml-highlight">
        <span dactyl:highlight="HelpXMLTagStart">
            <xsl:text>&lt;</xsl:text>
            <xsl:call-template name="xml-namespace"/>
            <xsl:apply-templates select="@*" mode="xml-highlight"/>
            <xsl:text>/></xsl:text>
        </span>
    </xsl:template>

    <xsl:template match="*[node()]" mode="xml-highlight">
        <span dactyl:highlight="HelpXMLTagStart">
            <xsl:text>&lt;</xsl:text>
            <xsl:call-template name="xml-namespace"/>
            <xsl:apply-templates select="@*" mode="xml-highlight"/>
            <xsl:text>></xsl:text>
        </span>
        <xsl:apply-templates select="node()" mode="xml-highlight"/>
        <span dactyl:highlight="HelpXMLTagEnd">
            <xsl:text>&lt;/</xsl:text>
            <xsl:call-template name="xml-namespace"/>
            <xsl:text>></xsl:text>
        </span>
    </xsl:template>

    <xsl:template match="dactyl:escape | dactyl:escape[node()]" mode="xml-highlight">
        <span dactyl:highlight="HelpXMLText">
            <xsl:apply-templates mode="help-1"/>
        </span>
    </xsl:template>

    <xsl:template match="@*" mode="xml-highlight">
        <xsl:text> </xsl:text>
        <span dactyl:highlight="HelpXMLAttribute">
            <xsl:call-template name="xml-namespace"/>
        </span>
        <span dactyl:highlight="HelpXMLString">
            <xsl:value-of select="regexp:replace(., '&quot;', 'g', '&amp;quot;')"/>
        </span>
    </xsl:template>

    <xsl:template match="comment()" mode="xml-highlight">
        <span dactyl:highlight="HelpXMLComment">
            <xsl:value-of select="."/>
        </span>
    </xsl:template>

    <xsl:template match="processing-instruction()" mode="xml-highlight">
        <span dactyl:highlight="HelpXMLProcessing">
            <xsl:value-of select="."/>
        </span>
    </xsl:template>

    <xsl:template match="text()" mode="xml-highlight">
        <span dactyl:highlight="HelpXMLText">
            <xsl:value-of select="regexp:replace(., '&lt;', 'g', '&amp;lt;')"/>
        </span>
    </xsl:template>
</xsl:stylesheet>

<!-- vim:se ft=xslt sts=4 sw=4 et fdm=marker: -->
