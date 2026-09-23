import { Container, Row, Col } from '@govtechsg/sgds-react';
import { useTranslation } from 'react-i18next';
import SystemInfoBar from './SystemInfoBar';

export default function Footer() {
  const { t } = useTranslation();

  return (
    <footer className="app-footer mt-auto py-4 bg-light">
      <Container>
        <Row>
          <Col className="text-center text-muted">
            <small>{t('app.footer')}</small>
            <SystemInfoBar />
          </Col>
        </Row>
      </Container>
    </footer>
  );
}
