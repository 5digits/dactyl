BEGIN {
    chrome = "chrome"
    if (suffix) {
        chrome = suffix
        print "# Suffix: " suffix
    }
}
{ content = $1 ~ /^(content|skin|locale|resource)$/ }
content && $NF ~ /^[a-z]/ { $NF = "/" name "/" $NF }
content {
    sub(/^\.\./, "", $NF);
    if (isjar)
	    $NF = "jar:chrome/" name ".jar!" $NF
    else
	    $NF = chrome $NF
}
{
    sub("^\\.\\./common/", "", $NF)
    print
    if (content && suffix && $1 == "resource") {
	    $2 = $2 "-" suffix
	    print
    }
}

# vim:se sts=4 sw=4 et ft=awk:
