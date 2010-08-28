<!DOCTYPE document SYSTEM "chrome://dactyl/content/dactyl.dtd">

<!-- Header {{{1 -->
<xsl:stylesheet version="1.0"
    xmlns="http://www.w3.org/1999/xhtml"
    xmlns:html="http://www.w3.org/1999/xhtml"
    xmlns:dactyl="http://vimperator.org/namespaces/liberator"
    xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
    xmlns:str="http://exslt.org/strings"
    xmlns:exsl="http://exslt.org/common"
    extension-element-prefixes="exsl str">

    <xsl:output method="xml" indent="no"/>

    <!-- Variable Definitions {{{1 -->

    <xsl:variable name="doc">
        <xsl:apply-templates select="/dactyl:document" mode="overlay"/>
    </xsl:variable>
    <xsl:variable name="root" select="exsl:node-set($doc)"/>

    <xsl:variable name="tags">
        <xsl:text> </xsl:text>
        <xsl:for-each select="$root//@tag|$root//dactyl:tags/text()|$root//dactyl:tag/text()">
            <xsl:value-of select="concat(., ' ')"/>
        </xsl:for-each>
    </xsl:variable>

    <!-- Process Overlays {{{1 -->

    <xsl:variable name="overlay" select="concat('dactyl://help-overlay/', /dactyl:document/@name)"/>
    <xsl:variable name="overlaydoc" select="document($overlay)/dactyl:overlay"/>

    <xsl:template name="splice-overlays">
        <xsl:param name="elem"/>
        <xsl:param name="tag"/>
        <xsl:for-each select="$overlaydoc/*[@insertbefore=$tag]">
            <xsl:apply-templates select="." mode="overlay"/>
        </xsl:for-each>
        <xsl:choose>
            <xsl:when test="$overlaydoc/*[@replace=$tag] and not($elem[@replace])">
                <xsl:for-each select="$overlaydoc/*[@replace=$tag]">
                    <xsl:apply-templates select="." mode="overlay-2"/>
                </xsl:for-each>
            </xsl:when>
            <xsl:otherwise>
                <xsl:for-each select="$elem">
                    <xsl:apply-templates select="." mode="overlay-2"/>
                </xsl:for-each>
            </xsl:otherwise>
        </xsl:choose>
        <xsl:for-each select="$overlaydoc/*[@insertafter=$tag]">
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

    <xsl:template match="dactyl:include" mode="overlay-2">
        <div dactyl:highlight="HelpInclude">
            <xsl:apply-templates select="document(@href)/dactyl:document/node()" mode="overlay"/>
        </div>
    </xsl:template>

    <xsl:template match="@*|node()" mode="overlay">
        <xsl:apply-templates select="." mode="overlay-2"/>
    </xsl:template>
    <xsl:template match="@*|node()" mode="overlay-2">
        <xsl:copy>
            <xsl:apply-templates select="@*|node()" mode="overlay"/>
        </xsl:copy>
    </xsl:template>

    <!-- Root {{{1 -->

    <xsl:template match="/">
        <xsl:for-each select="$root/dactyl:document">
            <html dactyl:highlight="Help">
                <head>
                    <title><xsl:value-of select="@title"/></title>
                    <script type="text/javascript"
                        src="chrome://dactyl/content/help.js"/>
                </head>
                <body dactyl:highlight="HelpBody">
                    <div dactyl:highlight="Logo"/>
                    <xsl:call-template name="parse-tags">
                        <xsl:with-param name="text" select="concat(@name, '.html')"/>
                    </xsl:call-template>
                    <xsl:apply-templates/>
                </body>
            </html>
        </xsl:for-each>
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
            <ol dactyl:highlight="HelpOrderedList">
                <xsl:for-each select="$nodes">
                    <li>
                        <a>
                            <xsl:if test="@tag">
                                <xsl:attribute name="href"><xsl:value-of select="concat('#', substring-before(concat(@tag, ' '), ' '))"/></xsl:attribute>
                            </xsl:if>
                            <xsl:apply-templates select="node()"/>
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
    <xsl:template match="dactyl:toc" mode="pass-2">
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
                <h2>Contents</h2>
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

    <xsl:template match="dactyl:strut" mode="pass-2">
        <div style="clear: both"/>
    </xsl:template>
    <xsl:template match="dactyl:item" mode="pass-2">
        <div dactyl:highlight="HelpItem">
            <xsl:apply-templates select="dactyl:tags|dactyl:spec|dactyl:strut"/>
            <xsl:if test="not(dactyl:description/@short)">
                <hr style="border: 0; height: 0; margin: 0; width: 100%; float: right;"/>
                <div dactyl:highlight="HelpOptInfo">
                    <xsl:apply-templates select="dactyl:type|dactyl:default"/>
                    <div style="clear: both;"/>
                </div>
            </xsl:if>
            <xsl:apply-templates select="dactyl:description"/>
            <div style="clear: both;"/>
        </div>
    </xsl:template>
    <xsl:template match="dactyl:spec[preceding-sibling::dactyl:spec]" mode="pass-2">
        <div style="clear: both;"/>
        <div dactyl:highlight="HelpSpec">
            <xsl:apply-templates/>
        </div>
    </xsl:template>

    <xsl:template match="dactyl:default[not(@type='plain')]" mode="pass-2">
        <xsl:variable name="type" select="preceding-sibling::dactyl:type[1] | following-sibling::dactyl:type[1]"/>
        <span dactyl:highlight="HelpDefault">(default:<xsl:text> </xsl:text>
            <xsl:choose>
                <xsl:when test="starts-with($type, 'string') or starts-with($type, 'regex')">
                    <span dactyl:highlight="HelpString"><xsl:apply-templates/></span>
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
                        <xsl:apply-templates/>
                    </span>
                </xsl:otherwise>
            </xsl:choose>)
        </span>
    </xsl:template>

    <!-- Tag Definitions {{{1 -->

    <xsl:template match="dactyl:tags" mode="pass-2">
        <div style="clear: right"/>
        <xsl:call-template name="parse-tags">
            <xsl:with-param name="text" select="."/>
        </xsl:call-template>
    </xsl:template>
    <xsl:template match="dactyl:tag|@tag" mode="pass-2">
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
        <xsl:variable name="tag" select="str:tokenize($contents, ' [!')[1]"/>
        <a href="dactyl://help-tag/{$tag}" style="color: inherit;">
            <xsl:if test="contains($tags, concat(' ', $tag, ' '))">
                <xsl:attribute name="href">#<xsl:value-of select="$tag"/></xsl:attribute>
            </xsl:if>
            <xsl:value-of select="$contents"/>
        </a>
    </xsl:template>

    <xsl:template match="dactyl:o" mode="pass-2">
        <span dactyl:highlight="HelpOption">
            <xsl:call-template name="linkify-tag">
                <xsl:with-param name="contents" select='concat("&#39;", text(), "&#39;")'/>
            </xsl:call-template>
        </span>
    </xsl:template>
    <xsl:template match="dactyl:t" mode="pass-2">
        <span dactyl:highlight="HelpTopic">
            <xsl:call-template name="linkify-tag"/>
        </span>
    </xsl:template>
    <xsl:template match="dactyl:k" mode="pass-2">
        <span dactyl:highlight="HelpKey">
            <xsl:call-template name="linkify-tag"/>
        </span>
    </xsl:template>
    <xsl:template match="dactyl:k[@name]" mode="pass-2">
        <span dactyl:highlight="HelpKey">
            <xsl:call-template name="linkify-tag">
                <xsl:with-param name="contents" select="concat('&lt;', @name, '>', .)"/>
            </xsl:call-template>
        </span>
    </xsl:template>

    <!-- HTML-ish elements {{{1 -->

    <xsl:template match="dactyl:dl" mode="pass-2">
        <dl>
            <column/>
            <column/>
            <xsl:for-each select="dactyl:dt">
                <tr>
                    <xsl:apply-templates select="."/>
                    <xsl:apply-templates select="following-sibling::dactyl:dd[1]"/>
                </tr>
            </xsl:for-each>
        </dl>
    </xsl:template>

    <xsl:template match="dactyl:link" mode="pass-2">
        <a href="{@topic}"><xsl:apply-templates select="@*|node()"/></a>
    </xsl:template>

    <xsl:template match="dactyl:em | dactyl:tt | dactyl:p  |
                         dactyl:dt | dactyl:dd |
                         dactyl:ol | dactyl:ul | dactyl:li |
                         dactyl:h1 | dactyl:h2 | dactyl:h3"
                         mode="pass-2">
        <xsl:element name="html:{local-name()}">
            <xsl:apply-templates select="@*|node()"/>
        </xsl:element>
    </xsl:template>

    <xsl:template match="dactyl:code" mode="pass-2">
        <pre dactyl:highlight="HelpCode"><xsl:apply-templates select="@*|node()"/></pre>
    </xsl:template>

    <!-- Help elements {{{1 -->

    <xsl:template match="dactyl:a" mode="pass-2">
        <span dactyl:highlight="HelpArg">{<xsl:apply-templates select="@*|node()"/>}</span>
    </xsl:template>
    <xsl:template match="dactyl:oa" mode="pass-2">
        <span dactyl:highlight="HelpOptionalArg">[<xsl:apply-templates select="@*|node()"/>]</span>
    </xsl:template>

    <xsl:template match="dactyl:note" mode="pass-2">
        <p style="clear: both;">
            <xsl:apply-templates select="@*"/>
            <div style="clear: both;"/>
            <span dactyl:highlight="HelpNote">Note:</span>
            <xsl:text> </xsl:text> 
            <xsl:apply-templates select="node()"/>
        </p>
    </xsl:template>
    <xsl:template match="dactyl:warning" mode="pass-2">
        <p style="clear: both;">
            <xsl:apply-templates select="@*"/>
            <div style="clear: both;"/>
            <span dactyl:highlight="HelpWarning">Warning:</span>
            <xsl:text> </xsl:text> 
            <xsl:apply-templates select="node()"/>
        </p>
    </xsl:template>
    <xsl:template match="dactyl:default" mode="pass-2">
        <span dactyl:highlight="HelpDefault">
            (default:<xsl:text> </xsl:text><xsl:apply-templates select="@*|node()"/>)
        </span>
    </xsl:template>

    <!-- HTML-ify other elements {{{1 -->

    <xsl:template match="dactyl:ex" mode="pass-2">
        <span dactyl:highlight="HelpEx">
            <xsl:variable name="tag" select="str:tokenize(text(), ' [!')[1]"/>
            <a href="dactyl://help-tag/{$tag}" style="color: inherit;">
                <xsl:if test="contains($tags, concat(' ', $tag, ' '))">
                    <xsl:attribute name="href">#<xsl:value-of select="$tag"/></xsl:attribute>
                </xsl:if>
                <xsl:apply-templates/>
            </a>
        </span>
    </xsl:template>

    <xsl:template match="dactyl:description | dactyl:example | dactyl:spec" mode="pass-2">
        <div>
            <xsl:if test="self::dactyl:description"><xsl:attribute name="dactyl:highlight">HelpDescription</xsl:attribute></xsl:if>
            <xsl:if test="self::dactyl:example"><xsl:attribute name="dactyl:highlight">HelpExample</xsl:attribute></xsl:if>
            <xsl:if test="self::dactyl:spec"><xsl:attribute name="dactyl:highlight">HelpSpec</xsl:attribute></xsl:if>
            <xsl:apply-templates select="@*|node()"/>
        </div>
    </xsl:template>
    <xsl:template match="dactyl:str | dactyl:t | dactyl:type" mode="pass-2">
        <span>
            <xsl:if test="self::dactyl:str"><xsl:attribute name="dactyl:highlight">HelpString</xsl:attribute></xsl:if>
            <xsl:if test="self::dactyl:t"><xsl:attribute name="dactyl:highlight">HelpTopic</xsl:attribute></xsl:if>
            <xsl:if test="self::dactyl:type"><xsl:attribute name="dactyl:highlight">HelpType</xsl:attribute></xsl:if>
            <xsl:apply-templates select="@*|node()"/>
        </span>
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
    <xsl:template match="dactyl:author[@email]" mode="pass-2">
        <xsl:call-template name="info">
            <xsl:with-param name="label" select="'Author'"/>
            <xsl:with-param name="extra">
                <xsl:text> </xsl:text><a href="mailto:{@email}">✉</a>
            </xsl:with-param>
        </xsl:call-template>
    </xsl:template>
    <xsl:template match="dactyl:author" mode="pass-2">
        <xsl:call-template name="info">
            <xsl:with-param name="label" select="'Author'"/>
        </xsl:call-template>
    </xsl:template>
    <xsl:template match="dactyl:license" mode="pass-2">
        <xsl:call-template name="info">
            <xsl:with-param name="label" select="'License'"/>
        </xsl:call-template>
    </xsl:template>
    <xsl:template match="dactyl:plugin" mode="pass-2">
        <xsl:call-template name="info">
            <xsl:with-param name="label" select="'Plugin'"/>
            <xsl:with-param name="nodes">
                <span><xsl:value-of select="@name"/></span>
            </xsl:with-param>
        </xsl:call-template>
        <xsl:apply-templates/>
    </xsl:template>

    <!-- Special Element Templates {{{1 -->

    <xsl:template match="dactyl:logo">
        <span dactyl:highlight="Logo"/>
    </xsl:template>

    <xsl:template match="dactyl:pan[dactyl:handle]">
        <form style="text-align:center" xmlns="http://www.w3.org/1999/xhtml"
              action="https://www.paypal.com/cgi-bin/webscr" method="post">
            <input type="hidden" name="cmd" value="_s-xclick"/>
            <input type="image" src="chrome://dactyl/content/x-click-but21.png" border="0" name="submit" alt="Donate with PayPal"/>
            <input type="hidden" name="encrypted" value="-----BEGIN PKCS7-----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-----END PKCS7-----
                "/>
        </form>
    </xsl:template>

    <!-- Process Tree {{{1 -->

    <xsl:template match="@*|node()" mode="pass-2">
        <xsl:copy>
            <xsl:apply-templates select="@*|node()"/>
        </xsl:copy>
    </xsl:template>
    <xsl:template match="@*|node()">
        <xsl:apply-templates select="." mode="pass-2"/>
    </xsl:template>
</xsl:stylesheet>

<!-- vim:se ft=xslt sts=4 sw=4 et fdm=marker: -->
