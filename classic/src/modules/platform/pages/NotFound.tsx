import { useLocation, Link } from "react-router-dom";
import { useEffect } from "react";
import { motion } from "framer-motion";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background relative overflow-hidden">
      {/* Subtle checkered background */}
      <div className="absolute inset-0 checkered-pattern opacity-[0.02] pointer-events-none" />

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="text-center relative z-10 px-6"
      >
        <h1
          className="font-racing text-primary/15 font-bold select-none"
          style={{ fontSize: "clamp(100px, 20vw, 180px)", lineHeight: 1, letterSpacing: "-0.04em" }}
        >
          404
        </h1>
        <p className="text-xl font-semibold text-foreground -mt-4" style={{ letterSpacing: "-0.02em" }}>
          Parece que voc&ecirc; saiu da pista.
        </p>
        <p className="text-sm text-muted-foreground mt-2 max-w-sm mx-auto">
          A p&aacute;gina que voc&ecirc; procura n&atilde;o existe ou foi movida.
        </p>
        <Link to="/">
          <Button variant="outline" className="mt-6 gap-2">
            <ArrowLeft className="w-4 h-4" />
            Voltar ao pit stop
          </Button>
        </Link>
      </motion.div>
    </div>
  );
};

export default NotFound;
