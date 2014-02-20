BEGIN {
    chrome = "chrome"
    if (suffix)
        chrome = suffix
}

{ content = $1 ~ /^(content|skin|locale|resource)$/ }

content && $NF ~ /^([a-z]|\.\/)/ {
    $NF = "/" name "/" $NF
}
content {
    sub(/^\.\./, "", $NF);
    if (isjar)
	    $NF = "jar:chrome/" name ".jar!" $NF
    else
	    $NF = chrome $NF
}
{
    gsub(/\/\.\//, "/")
    sub("^\\.\\./common/", "", $NF)
    print
}

# vim:se sts=4 sw=4 et ft=awk:
