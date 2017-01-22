cp sample-warn.js sample-warn2.js
bin/eslint.js --fix --fix-severity error sample-warn2.js
diff sample-warn.js sample-warn2.js

cp sample-error.js sample-error2.js
bin/eslint.js --fix --fix-severity error sample-error2.js
diff sample-error.js sample-error2.js
