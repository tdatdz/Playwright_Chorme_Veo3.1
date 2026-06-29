const fs = require('fs');

let code = fs.readFileSync('src/app-server.js', 'utf8');

const brokenBlock = `    const body = await readJson(request);
    const workspaceId = body.workspaceId;
    if (!workspaceId) {
      sendJson(response, 400, { error: 'workspaceId is required' });
      return;
    }
    assertIdle(workspaceId);
    const instruction = String(body.instruction || '').trim();
    if (!instruction) throw new Error('Vui lòng nhập instruction.');
    const st = getWorkspaceState(workspaceId);
    st.operation = 'run-flow';
    try {
      const connection = await ensureChromeConnection(workspaceId);
      const page = await ensureFlowProject(connection.page, {
        onEvent: flowEvent,
        createIfMissing: true,
      });
      st.connection.page = page;
      st.activeFlowProjectId = flowProjectId(page);

      log('INFO', \`Script Studio: Bắt đầu thực thi: "\${instruction}"\`, { workspaceId });
      const { runDirector } = await import('./script-director.js');
      const results = await runDirector({
        page,
        instruction,
        workspaceId,
        onEvent: (event) => {
          if (event.type === 'resolve') {
            log('INFO', \`DIR tìm control: \${event.control}\`, { workspaceId });
          } else if (event.type === 'action') {
            log('ACTION', \`DIR \${event.action.toUpperCase()} → \${event.control}\`, { workspaceId });
          } else if (event.type === 'error') {
            log('ERROR', \`DIR \${event.message}\`, { workspaceId });
          } else if (event.type === 'success') {
            log('SUCCESS', \`DIR hoàn tất: \${event.control}\`, { workspaceId });
          } else if (event.type === 'wait') {
            log('WAIT', \`DIR chờ \${event.milliseconds} ms\`, { workspaceId });
          }
        },
      });
      log(
        'SUCCESS',
        \`Script Studio: Hoàn tất với \${results.length} thao tác.\`,
        { workspaceId }
      );
      sendJson(response, 200, { ok: true, results });
    } finally {
      st.operation = null;
    }
    return;
  }`;

const replacement = `    const { workspace, batch } = workspaceResult;
    const selectedIds = new Set(batch.jobs.map((job) => job.id));
    log(
      'SUCCESS',
      \`Đã nạp \${batch.jobs.length} prompt từ \${master.scenes.length} scene vào Timeline.\`,
      {
        refreshBatch: true,
        refreshWorkspaces: true,
        workspaceId: workspace.id,
      },
    );

    const st = getWorkspaceState(workspace.id);
    st.operation = 'master-flow-run';
    try {
      const connection = await ensureChromeConnection(workspace.id);
      const page = await ensureFlowProject(connection.page, {
        onEvent: flowEvent,
        createIfMissing: true,
      });
      st.connection.page = page;
      st.activeFlowProjectId = flowProjectId(page);
      log(
        'INFO',
        \`Bắt đầu Master Flow Run tại project \${st.activeFlowProjectId}.\`,
        { workspaceId: workspace.id },
      );
      const results = await runBatchWithLogging({
        page,
        batch,
        workspaceId: workspace.id,
        selectedIds,
        dryRun: false,
      });
      sendJson(response, 200, {
        ok: true,
        workspaceId: workspace.id,
        projectId: st.activeFlowProjectId,
        results,
      });
    } finally {
      st.operation = null;
    }
    return;
  }`;

if (code.includes(brokenBlock)) {
  code = code.replace(brokenBlock, replacement);
  fs.writeFileSync('src/app-server.js', code);
  console.log('Successfully repaired src/app-server.js');
} else {
  console.error('Could not find the broken block in src/app-server.js');
}
