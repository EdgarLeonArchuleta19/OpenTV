#!/bin/sh
# Compiles Crypto.java alone with the JDK and compares it with the Node service.
set -e
cd "$(dirname "$0")"
J=${JAVA_HOME:-/c/Users/DO-EdgarL/dev/jdk17}
rm -rf out && mkdir out
"$J/bin/javac" -encoding UTF-8 -d out ../../android/app/src/main/java/com/techpoint/opentv/service/Crypto.java CryptoCheck.java
"$J/bin/java" -Dfile.encoding=UTF-8 -Dstdout.encoding=UTF-8 -cp out CryptoCheck > out/java.txt
unset ELECTRON_RUN_AS_NODE
node check.cjs out/java.txt
