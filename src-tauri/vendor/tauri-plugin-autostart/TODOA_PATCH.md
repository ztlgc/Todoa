# Todoa Windows patch, upstream 2.7.0

The locked Windows setup passes current_exe verbatim into auto-launch 0.6.0,
which builds the Run command as `app_path args`, without quoting. Installed
paths with spaces therefore do not form the intended executable command line.
The Windows setup now quotes current_exe and explicitly selects CurrentUser
instead of Dynamic (which first tries to register for every user in HKLM).

The official plugin API, AutoLaunchManager, OS state queries and permissions
remain unchanged. The whole upstream package and licenses are preserved.
Re-audit these two setup lines on plugin upgrades.
