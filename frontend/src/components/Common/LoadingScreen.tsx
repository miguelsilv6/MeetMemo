import { Container, Row, Col, Card, ProgressBar, Button, Alert } from '@govtechsg/sgds-react';
import { FileText, AlertCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface LoadingScreenProps {
  backendError: string | null;
}

export default function LoadingScreen({ backendError }: LoadingScreenProps) {
  const { t } = useTranslation();

  // Show error screen if backend failed to load
  if (backendError) {
    return (
      <div
        className="app d-flex align-items-center justify-content-center"
        style={{ minHeight: '100vh', backgroundColor: 'var(--mm-bg, #f8fafc)' }}
      >
        <Container>
          <Row className="justify-content-center">
            <Col md={6} className="text-center">
              <Card className="shadow-sm border-0">
                <Card.Body className="p-5">
                  <AlertCircle size={64} className="text-secondary mb-4" />
                  <h2 className="mb-3">{t('loadingScreen.connectionError')}</h2>
                  <Alert variant="danger" className="mb-4">
                    {backendError}
                  </Alert>
                  <p className="text-muted mb-4">{t('loadingScreen.connectionHint')}</p>
                  <Button variant="primary" onClick={() => window.location.reload()}>
                    {t('loadingScreen.retry')}
                  </Button>
                </Card.Body>
              </Card>
            </Col>
          </Row>
        </Container>
      </div>
    );
  }

  // Show loading screen while backend is initializing
  return (
    <div
      className="app d-flex align-items-center justify-content-center"
      style={{ minHeight: '100vh', backgroundColor: 'var(--mm-bg, #f8fafc)' }}
    >
      <Container>
        <Row className="justify-content-center">
          <Col md={6} className="text-center">
            <Card className="shadow-sm border-0">
              <Card.Body className="p-5">
                <FileText size={64} className="text-primary my-4" />
                <h2 className="mb-3">{t('app.name')}</h2>
                <p className="text-muted mb-4">{t('loadingScreen.tagline')}</p>
                <div className="spinner-border text-primary mb-3" role="status">
                  <span className="visually-hidden">{t('common.loading')}</span>
                </div>
                <p className="text-muted small">{t('loadingScreen.connecting')}</p>
              </Card.Body>
            </Card>
          </Col>
        </Row>
      </Container>
    </div>
  );
}
