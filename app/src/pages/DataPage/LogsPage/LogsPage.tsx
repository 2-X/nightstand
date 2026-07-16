import { useEffect, useMemo, useState, useRef } from 'react';
import { baseURL } from '@api/api';
import {
  Paper, Typography, Box, MenuItem, Select, FormControl, InputLabel,
  TextField, IconButton, Tooltip, Chip, CircularProgress,
} from '@mui/material';
import PageContainer from '../../PageContainer.tsx';
import { useTheme } from '@mui/material/styles';
import axios from 'axios';
import Header from '../Header.tsx';
import TextSnippetIcon from '@mui/icons-material/TextSnippet';
import DownloadIcon from '@mui/icons-material/Download';
import ClearAllIcon from '@mui/icons-material/ClearAll';
import PauseIcon from '@mui/icons-material/Pause';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import { useSettings } from '@api/settings.ts';
import { getLogDescription, detectLogLevel } from './logsMeta.ts';
import { appendCapped } from './logsBuffer.ts';


const LEVEL_COLORS: Record<string, string> = {
  error: '#ff6b6b',
  warn: '#ffb84d',
  debug: '#7a8290',
  info: '#9fd3ff',
};

export default function LogsPage() {
  const { data: settings, isLoading: settingsLoading } = useSettings();
  const logsViewerEnabled = !!settings?.features.logsViewer;
  const [logs, setLogs] = useState<string[]>([]);
  const [pendingLogs, setPendingLogs] = useState<string[]>([]);
  const [logFiles, setLogFiles] = useState<string[]>([]);
  const [selectedLog, setSelectedLog] = useState<string>('');
  const [filterText, setFilterText] = useState('');
  const [paused, setPaused] = useState(false);
  const logsContainerRef = useRef<HTMLDivElement | null>(null);
  const logsEndRef = useRef<HTMLDivElement | null>(null);
  const isUserAtBottom = useRef(true);
  // The SSE subscription effect only re-runs when selectedLog changes, so its
  // onmessage closure would otherwise see a stale `paused` from subscribe
  // time, so read the live value through a ref instead.
  const pausedRef = useRef(false);
  const theme = useTheme();

  // Fetch available log files. Skipped entirely while the feature is off,
  // the server 403s the same request anyway.
  useEffect(() => {
    if (!logsViewerEnabled) return;

    const fetchLogFiles = async () => {
      try {
        const response = await axios.get<{ logs: string[] }>(`${baseURL}/api/logs`);
        if (response.data.logs.length > 0) {
          setLogFiles(response.data.logs);
          setSelectedLog(response.data.logs[0]); // Default to the latest log file
        }
      } catch (error) {
        console.error('Error fetching log files:', error);
      }
    };

    fetchLogFiles();
  }, [logsViewerEnabled]);

  // Subscribe to log updates for the selected file
  useEffect(() => {
    if (!logsViewerEnabled || !selectedLog) return;

    const eventSource = new EventSource(`${baseURL}/api/logs/${selectedLog}`);

    eventSource.onmessage = (event) => {
      const logData = JSON.parse(event.data);
      const newLines: string[] = logData.message.split('\n');
      if (pausedRef.current) {
        // Capped the same way as `logs` below: otherwise a busy log file
        // left streaming while paused grows this array without bound.
        setPendingLogs((prev) => appendCapped(prev, newLines));
      } else {
        setLogs((prevLogs) => appendCapped(prevLogs, newLines));
      }
    };

    eventSource.onerror = () => {
      eventSource.close();
    };

    return () => {
      eventSource.close();
    };
  }, [selectedLog, logsViewerEnabled]); // Re-run when the log file changes, or the feature flag flips; pause state is read live via pausedRef

  // Track if user is at the bottom
  const handleScroll = () => {
    if (!logsContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = logsContainerRef.current;
    isUserAtBottom.current = scrollHeight - scrollTop <= clientHeight + 50; // 50px buffer
  };

  // Auto-scroll only if user is at the bottom
  useEffect(() => {
    if (isUserAtBottom.current) {
      logsEndRef.current?.scrollIntoView({ behavior: 'auto' });
    }
  }, [logs]);

  const handleTogglePause = () => {
    if (paused) {
      // Resuming, so flush anything buffered while paused.
      setLogs((prevLogs) => appendCapped(prevLogs, pendingLogs));
      setPendingLogs([]);
    }
    pausedRef.current = !paused;
    setPaused((p) => !p);
  };

  const handleClear = () => {
    setLogs([]);
    setPendingLogs([]);
  };

  const handleDownload = () => {
    const blob = new Blob([logs.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = selectedLog || 'log.txt';
    a.click();
    URL.revokeObjectURL(url);
  };

  const filteredLogs = useMemo(() => {
    if (!filterText.trim()) return logs;
    const needle = filterText.toLowerCase();
    return logs.filter((line) => line.toLowerCase().includes(needle));
  }, [logs, filterText]);

  if (settingsLoading) {
    return (
      <PageContainer>
        <Header title="Logs" icon={ <TextSnippetIcon /> }/>
        <CircularProgress sx={ { display: 'block', mx: 'auto', mt: 4 } }/>
      </PageContainer>
    );
  }

  if (!logsViewerEnabled) {
    return (
      <PageContainer>
        <Header title="Logs" icon={ <TextSnippetIcon /> }/>
        <Typography sx={ { color: 'text.secondary', mt: 2 } }>
          The logs viewer is turned off in Settings &gt; Features.
        </Typography>
      </PageContainer>
    );
  }

  return (
    <PageContainer
      sx={ {
        [theme.breakpoints.up('sm')]: {
          width: '95%',
          padding: 0,
          paddingTop: 6,
          paddingBottom: 6,
          maxWidth: '100%',
          height: '100%',
        },
      } }
    >
      <Header title="Logs" icon={ <TextSnippetIcon /> }/>

      <Paper
        elevation={ 3 }
        sx={ {
          p: 2,
          bgcolor: theme.palette.background.paper,
          color: '#fff',
          borderRadius: 2,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          [theme.breakpoints.up('sm')]: {
            width: '100%',
          },
        } }
      >
        <Box sx={ { display: 'flex', gap: 1.5, alignItems: 'flex-start', flexWrap: 'wrap', mb: 1 } }>
          <FormControl sx={ { minWidth: 200 } }>
            <InputLabel sx={ { color: theme.palette.grey[100] } }>Log file</InputLabel>
            <Select
              value={ selectedLog }
              onChange={ (e) => {
                setLogs([]);
                setPendingLogs([]);
                setSelectedLog(e.target.value);
              } }
            >
              { logFiles.map((file) => (
                <MenuItem key={ file } value={ file }>
                  { file }
                </MenuItem>
              )) }
            </Select>
          </FormControl>

          <TextField
            size="small"
            placeholder="Filter visible lines…"
            value={ filterText }
            onChange={ (e) => setFilterText(e.target.value) }
            sx={ { minWidth: 220, flex: 1 } }
          />

          <Box sx={ { display: 'flex', gap: 0.5 } }>
            <Tooltip title={ paused ? `Resume (${pendingLogs.length} new)` : 'Pause live updates' }>
              <IconButton onClick={ handleTogglePause } size="small" sx={ { color: theme.palette.grey[100] } }>
                { paused ? <PlayArrowIcon /> : <PauseIcon /> }
              </IconButton>
            </Tooltip>
            <Tooltip title="Clear displayed lines">
              <IconButton onClick={ handleClear } size="small" sx={ { color: theme.palette.grey[100] } }>
                <ClearAllIcon />
              </IconButton>
            </Tooltip>
            <Tooltip title="Download what's currently loaded">
              <IconButton onClick={ handleDownload } size="small" sx={ { color: theme.palette.grey[100] } } disabled={ logs.length === 0 }>
                <DownloadIcon />
              </IconButton>
            </Tooltip>
          </Box>
        </Box>

        { selectedLog && (
          <Typography sx={ { color: theme.palette.grey[400], fontSize: '0.8rem', mb: 1.5 } }>
            { getLogDescription(selectedLog) }
          </Typography>
        ) }

        { paused && pendingLogs.length > 0 && (
          <Chip
            label={ `${pendingLogs.length} new line${pendingLogs.length === 1 ? '' : 's'} buffered (resume to see them)` }
            size="small"
            onClick={ handleTogglePause }
            sx={ { mb: 1, alignSelf: 'flex-start', cursor: 'pointer' } }
          />
        ) }

        <Typography
          variant="h6"
          sx={ {
            fontWeight: 'bold',
            color: theme.palette.grey[100],
            pb: 1,
            borderBottom: `1px solid ${theme.palette.grey[700]}`,
            position: 'sticky',
            top: 0,
            zIndex: 1,
            paddingBottom: 1,
          } }
        >
          { filterText ? `Filtered lines (${filteredLogs.length}/${logs.length})` : 'Live Server Logs' }
        </Typography>

        <Box
          ref={ logsContainerRef }
          onScroll={ handleScroll }
          sx={ {
            flex: 1,
            overflowY: 'auto',
            maxHeight: `${window.innerHeight - 340}px`,
            fontFamily: 'monospace',
            p: 1,
            '&::-webkit-scrollbar': {
              width: '10px',
            },
            '&::-webkit-scrollbar-track': {
              background: theme.palette.background.paper,
              borderRadius: '5px',
            },
            '&::-webkit-scrollbar-thumb': {
              background: theme.palette.grey[600],
              borderRadius: '5px',
            },
            '&::-webkit-scrollbar-thumb:hover': {
              background: theme.palette.grey[500],
            },
          } }
        >
          { filteredLogs.map((line, i) => {
            const level = detectLogLevel(line);
            return (
              <Typography
                key={ i }
                component="div"
                sx={ {
                  fontFamily: 'monospace',
                  color: level ? LEVEL_COLORS[level] : theme.palette.grey[200],
                  fontSize: '12px',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                } }
              >
                { line }
              </Typography>
            );
          }) }
          <div ref={ logsEndRef } />
        </Box>
      </Paper>
    </PageContainer>
  );
}
