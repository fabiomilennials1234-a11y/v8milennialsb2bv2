import { motion } from "framer-motion";
import torqueLogo from "@/assets/torque-logo.png";

interface TorqueLogoProps {
  size?: "sm" | "md" | "lg" | "xl";
  animated?: boolean;
  className?: string;
}

export function TorqueLogo({
  size = "md",
  animated = true,
  className = ""
}: TorqueLogoProps) {
  const logoSizes = {
    sm: "h-8",
    md: "h-12",
    lg: "h-16",
    xl: "h-24",
  };

  const LogoWrapper = animated ? motion.div : "div";

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <LogoWrapper
        {...(animated && {
          initial: { scale: 0.8, opacity: 0 },
          animate: { scale: 1, opacity: 1 },
          transition: { type: "spring", duration: 0.5 }
        })}
      >
        <img src={torqueLogo} alt="Torque CRM" className={logoSizes[size]} />
      </LogoWrapper>
    </div>
  );
}

/** @deprecated Use TorqueLogo instead */
export const V8Logo = TorqueLogo;

// Racing-themed page header
export function V8PageHeader({ 
  title, 
  subtitle, 
  icon: Icon,
  action 
}: { 
  title: string; 
  subtitle?: string; 
  icon?: React.ElementType;
  action?: React.ReactNode;
}) {
  return (
    <motion.div 
      className="flex items-center justify-between mb-6"
      initial={{ opacity: 0, x: -30 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.5, ease: "easeOut" }}
    >
      <div className="flex items-center gap-3">
        {Icon && (
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ delay: 0.2, type: "spring" }}
            className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center"
          >
            <Icon className="w-6 h-6 text-primary" />
          </motion.div>
        )}
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            {title}
            <motion.span 
              className="text-lg"
              animate={{ rotate: [0, 10, -10, 0] }}
              transition={{ repeat: Infinity, duration: 2, repeatDelay: 3 }}
            >
              🏁
            </motion.span>
          </h1>
          {subtitle && (
            <p className="text-muted-foreground">{subtitle}</p>
          )}
        </div>
      </div>
      {action}
    </motion.div>
  );
}

// Checkered flag divider
export function CheckeredDivider() {
  return (
    <div className="w-full h-4 checkered-pattern opacity-10 my-4" />
  );
}
