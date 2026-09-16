// src/components/PaymentModal.tsx
'use client';
import styles from '@/styles/modal.module.css';
import AccountControls from './AccountControls';

interface PaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (sessionId: string, amount: string) => void;
  onSkip: () => void;
  accountId: string;
  email: string;
}

// Thin modal chrome around <AccountControls> (§8 step 1). The account operations
// moved into AccountControls verbatim; this wrapper only supplies the modal
// shell. `email`/`onSkip` are kept in the interface (HomeClient passes them) but
// unused here, exactly as before. Returning null when closed unmounts
// AccountControls, so its state resets on each open (replacing the old
// reset-on-close effect).
export default function PaymentModal({ isOpen, onClose, onSubmit, accountId }: PaymentModalProps) {
  if (!isOpen) return null;

  return (
    <div className={styles.modalOverlay}>
      <div className={styles.modalDialog}>
        <div className={`${styles.modalContent} ${styles.paymentModal}`}>
          <div className={styles.modalHeader}>
            <h5 className={styles.modalTitle}>Manage Account</h5>
            <button type="button" className={styles.closeButton} onClick={onClose}>
              ×
            </button>
          </div>
          <div className={styles.modalBody}>
            <AccountControls accountId={accountId} onSubmit={onSubmit} onClose={onClose} />
          </div>
        </div>
      </div>
    </div>
  );
}