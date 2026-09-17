@echo off
cd /d "%~dp0"

echo ===================================
echo  Checking for new movies...
echo ===================================
node scrape-listing.mjs --categories English,Hindi --max-pages 5

echo.
echo ===================================
echo  Fetching play links for anything new...
echo ===================================
node scrape-details.mjs

echo.
echo ===================================
echo  Uploading to GitHub...
echo ===================================
git add index.json
git commit -m "Auto-update movie index"
git push

echo.
echo ===================================
echo  DONE. Vercel will redeploy automatically in a minute or two.
echo ===================================
pause
