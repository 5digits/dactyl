<!DOCTYPE document SYSTEM "chrome://dactyl/content/dactyl.dtd">

<xsl:stylesheet version="1.0"
    xmlns="http://www.w3.org/1999/xhtml"
    xmlns:html="http://www.w3.org/1999/xhtml"
    xmlns:dactyl="http://vimperator.org/namespaces/liberator"
    xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
    xmlns:str="http://exslt.org/strings"
    xmlns:exsl="http://exslt.org/common"
    extension-element-prefixes="exsl str">

    <xsl:output method="xml" indent="no"/>

    <xsl:variable name="root" select="/dactyl:document"/>
    <xsl:variable name="tags">
        <xsl:text> </xsl:text>
        <xsl:for-each select="$root//@tag|$root//dactyl:tags/text()|$root//dactyl:tag/text()">
            <xsl:value-of select="concat(., ' ')"/>
        </xsl:for-each>
    </xsl:variable>

    <xsl:template name="parse-tags">
        <xsl:param name="text"/>
        <div dactyl:highlight="HelpTags">
        <xsl:for-each select="str:tokenize($text)">
            <a id="{.}" dactyl:highlight="HelpTag"><xsl:value-of select="."/></a>
        </xsl:for-each>
        </div>
    </xsl:template>

    <xsl:template match="/">
        <xsl:call-template name="parse-tags">
            <xsl:with-param name="text" select="$tags"/>
        </xsl:call-template>
    </xsl:template>
</xsl:stylesheet>
