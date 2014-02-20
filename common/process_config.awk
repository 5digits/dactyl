BEGIN {
    chrome = "chrome"
    if (suffix)
        chrome = suffix
}
/^    \}/              { on = 0 }

on && $NF ~ /^"([a-z]|\.\/)/ {
    $NF = "\"/" name "/" substr($NF, 2)
}
/./ && on {
    sub(/^"\.\./, "\"", $NF);
    $NF = "\"" chrome substr($NF, 2)
}
/./ && on {
    gsub(/\/\.\//, "/")
    sub(/^\"\.\.\/common\//, "\"", $NF)
    $0 = "        " $0
}
//

/^    "resources": \{/ { on = 1 }
