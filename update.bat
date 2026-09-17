@echo off
cd /d "%~dp0"

echo ===================================
echo  MOVIES: Checking for new releases...
echo ===================================
node scrape-listing.mjs --categories English,Hindi --max-pages 5

echo.
echo ===================================
echo  MOVIES: Fetching play links for anything new...
echo ===================================
node scrape-details.mjs

echo.
echo ===================================
echo  SERIES: Checking recent shows for new episodes...
echo  and sweeping for brand new shows...
echo ===================================
node scrape-series.mjs --refresh 300

echo.
echo ===================================
echo  Uploading to GitHub...
echo ===================================
git add index.json index-series.json
git commit -m "Auto-update movie and series index"
git push

echo.
echo ===================================
echo  DONE. Vercel will redeploy automatically in a minute or two.
echo ===================================
pause
