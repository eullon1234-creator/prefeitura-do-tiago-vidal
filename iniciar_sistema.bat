@echo off
chcp 65001 > nul
echo ========================================================
echo    PREFEITURA DE CANTEIRO - CONTROLE DE ALOJAMENTOS
echo    Canteiro de Obra - Taboca 2
echo ========================================================
echo.
echo Iniciando servidor web e banco de dados...
start http://localhost:8000
python -m uvicorn app:app --host 0.0.0.0 --port 8000 --reload
pause
