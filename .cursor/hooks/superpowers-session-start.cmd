@echo off
REM Project-level Superpowers sessionStart hook for Cursor cloud agents.
REM Sets CURSOR_PLUGIN_ROOT so vendor/superpowers/hooks/session-start emits Cursor JSON.

set "PROJECT_ROOT=%~dp0..\.."
for %%I in ("%PROJECT_ROOT%") do set "PROJECT_ROOT=%%~fI"
set "CURSOR_PLUGIN_ROOT=%PROJECT_ROOT%\vendor\superpowers"

cd /d "%PROJECT_ROOT%"
call "%CURSOR_PLUGIN_ROOT%\hooks\run-hook.cmd" session-start
