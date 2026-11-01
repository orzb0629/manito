import {assignmentReadiness} from '../src/backend/assignment-readiness.ts';
import type {TeacherSnapshot} from '../src/backend/types.ts';
import {ApiError} from './security.ts';
export function checkAssignmentState(state:TeacherSnapshot,versions:{rosterVersion:unknown;settingsVersion:unknown}) {
 if(!Number.isInteger(versions.rosterVersion)||Number(versions.rosterVersion)<0||!Number.isInteger(versions.settingsVersion)||Number(versions.settingsVersion)<0)throw new ApiError(400,'invalid_input');
 if(state.rosterVersion!==versions.rosterVersion||state.settingsVersion!==versions.settingsVersion)throw new ApiError(409,'assignment_changed');
 const readiness=assignmentReadiness(state);
 if(readiness==='locked')throw new ApiError(409,'assignment_locked');
 if(readiness==='students')throw new ApiError(400,'minimum_three_students');
 if(readiness==='missions')throw new ApiError(422,'assignment_not_ready');
}
