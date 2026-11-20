// Product / organisation name shown in the UI. Set PUBLIC_APP_NAME and PUBLIC_ORG_NAME in the environment.
import { env } from '$env/dynamic/public';

export const APP_NAME = env.PUBLIC_APP_NAME || 'Visitor Management System';
export const ORG_NAME = env.PUBLIC_ORG_NAME || '';
