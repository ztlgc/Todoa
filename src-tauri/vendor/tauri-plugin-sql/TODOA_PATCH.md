# Todoa STEP 18 patch (upstream 2.5.0)

The upstream setup creates a pool, runs migrations, and only then manages
DbInstances. A migration error returns early and drops that unregistered pool;
SQLx Pool Drop initiates asynchronous cleanup. App code therefore cannot await
its closure before restore rollback renames the database files.

The setup error branch now explicitly awaits close() for that pool and any
earlier preloaded pools before returning the migration error. Normal SQL,
migrations, paths and permissions are unchanged. The complete upstream package
and licenses are retained. Re-audit this branch when upgrading the plugin.

The native isolated STEP 18 build exercises an actual migration checksum error
with a debug-only app feature, then confirms the original group is restored.
The release/default build has no such fault hook.
