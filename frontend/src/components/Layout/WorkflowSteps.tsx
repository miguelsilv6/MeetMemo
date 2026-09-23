import { Container } from '@govtechsg/sgds-react';
import { UploadIcon, Users, FileText, Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { WorkflowStep } from '../../types/api';

interface WorkflowStepsProps {
  currentStep: WorkflowStep;
}

export default function WorkflowSteps({ currentStep }: WorkflowStepsProps) {
  const { t } = useTranslation();

  return (
    <div className="workflow-steps bg-light py-3">
      <Container>
        <div className="steps-container">
          <div className={`step ${currentStep === 'upload' ? 'active' : 'completed'}`}>
            <div className="step-icon">
              <UploadIcon size={20} />
            </div>
            <div className="step-label">{t('workflowSteps.upload')}</div>
          </div>
          <div className="step-divider"></div>
          <div
            className={`step ${currentStep === 'processing' ? 'active' : currentStep === 'transcript' || currentStep === 'summary' ? 'completed' : ''}`}
          >
            <div className="step-icon">
              <Users size={20} />
            </div>
            <div className="step-label">{t('workflowSteps.processing')}</div>
          </div>
          <div className="step-divider"></div>
          <div
            className={`step ${currentStep === 'transcript' ? 'active' : currentStep === 'summary' ? 'completed' : ''}`}
          >
            <div className="step-icon">
              <FileText size={20} />
            </div>
            <div className="step-label">{t('workflowSteps.transcript')}</div>
          </div>
          <div className="step-divider"></div>
          <div className={`step ${currentStep === 'summary' ? 'active' : ''}`}>
            <div className="step-icon">
              <Sparkles size={20} />
            </div>
            <div className="step-label">{t('workflowSteps.summary')}</div>
          </div>
        </div>
      </Container>
    </div>
  );
}
