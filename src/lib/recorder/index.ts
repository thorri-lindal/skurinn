export {
	startRecording,
	stopRecording,
	recordSnapshot,
	isRecording,
	currentSessionId,
	listSessions,
	deleteSession,
	loadSessionEvents,
	exportSession,
	importSession,
} from './recorder.js';

export { addCoveragePoint, loadCoveragePoints, clearCoverage } from './coverage.js';

export type { RecordedSession, SessionEvent, CoveragePoint } from './types.js';
