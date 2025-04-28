import { StackProps } from 'aws-cdk-lib';

export interface AppApiStackProps extends StackProps {
    environment: string;
    coreStack: string;
}
