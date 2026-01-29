import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Campanha, CampanhaStage, CampanhaLead, CampanhaMember } from "@/hooks/useCampanhas";
import { format, differenceInDays, isPast } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Target, Users, Trophy, Calendar, TrendingUp, DollarSign, Award, Flame, Zap, Crown, Star, Sparkles } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";

interface CampanhaAnalyticsProps {
  campanha: Campanha;
  stages: CampanhaStage[];
  leads: CampanhaLead[];
  members: CampanhaMember[];
}

// Animated counter component
function AnimatedNumber({ value, prefix = "", suffix = "" }: { value: number; prefix?: string; suffix?: string }) {
  return (
    <motion.span
      key={value}
      initial={{ opacity: 0, y: 20, scale: 0.8 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: "spring", stiffness: 300, damping: 20 }}
    >
      {prefix}{value.toLocaleString("pt-BR")}{suffix}
    </motion.span>
  );
}

// Progress ring component for individual goals
function ProgressRing({ progress, size = 80, strokeWidth = 8, showLabel = true }: { 
  progress: number; 
  size?: number; 
  strokeWidth?: number;
  showLabel?: boolean;
}) {
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const offset = circumference - (Math.min(progress, 100) / 100) * circumference;
  const isComplete = progress >= 100;

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="transform -rotate-90">
        {/* Background circle */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="hsl(var(--muted))"
          strokeWidth={strokeWidth}
        />
        {/* Progress circle */}
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={isComplete ? "hsl(var(--success))" : "hsl(var(--primary))"}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 1.5, ease: "easeOut" }}
          className={isComplete ? "drop-shadow-[0_0_8px_hsl(var(--success))]" : ""}
        />
      </svg>
      {showLabel && (
        <div className="absolute inset-0 flex items-center justify-center">
          <motion.span 
            className={`text-lg font-bold ${isComplete ? "text-success" : ""}`}
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ delay: 0.5, type: "spring" }}
          >
            {Math.round(progress)}%
          </motion.span>
        </div>
      )}
      {isComplete && (
        <motion.div
          className="absolute -top-1 -right-1"
          initial={{ scale: 0, rotate: -180 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ delay: 1, type: "spring", stiffness: 200 }}
        >
          <div className="w-6 h-6 bg-success rounded-full flex items-center justify-center shadow-lg">
            <Sparkles className="w-3 h-3 text-white" />
          </div>
        </motion.div>
      )}
    </div>
  );
}

// Individual member card with gamification
function MemberGoalCard({ 
  member, 
  reunioes, 
  meta, 
  rank,
  bonusValue 
}: { 
  member: CampanhaMember; 
  reunioes: number; 
  meta: number; 
  rank: number;
  bonusValue: number;
}) {
  const progress = meta > 0 ? (reunioes / meta) * 100 : 0;
  const isComplete = progress >= 100;
  const remaining = Math.max(0, meta - reunioes);

  const getRankIcon = () => {
    if (rank === 1) return <Crown className="w-5 h-5 text-yellow-400" />;
    if (rank === 2) return <Trophy className="w-5 h-5 text-gray-400" />;
    if (rank === 3) return <Award className="w-5 h-5 text-orange-400" />;
    return <span className="text-muted-foreground font-bold">{rank}º</span>;
  };

  const getRankBg = () => {
    if (rank === 1) return "from-yellow-500/20 via-yellow-500/10 to-transparent border-yellow-500/30";
    if (rank === 2) return "from-gray-400/20 via-gray-400/10 to-transparent border-gray-400/30";
    if (rank === 3) return "from-orange-500/20 via-orange-500/10 to-transparent border-orange-500/30";
    return "from-muted/30 to-transparent border-border";
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: rank * 0.1 }}
      whileHover={{ scale: 1.02 }}
      className={`relative overflow-hidden rounded-xl border bg-gradient-to-r ${getRankBg()} p-4`}
    >
      {/* Glow effect for completed */}
      {isComplete && (
        <motion.div
          className="absolute inset-0 bg-gradient-to-r from-success/10 to-transparent"
          animate={{ opacity: [0.5, 1, 0.5] }}
          transition={{ duration: 2, repeat: Infinity }}
        />
      )}

      <div className="relative flex items-center gap-4">
        {/* Rank badge */}
        <div className="flex-shrink-0 w-10 h-10 rounded-full bg-background/50 flex items-center justify-center">
          {getRankIcon()}
        </div>

        {/* Member info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h4 className="font-semibold truncate">{member.team_member?.name}</h4>
            {isComplete && (
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: "spring", delay: 0.3 }}
              >
                <Badge className="bg-success/20 text-success border-success/30 gap-1">
                  <Zap className="w-3 h-3" />
                  META BATIDA!
                </Badge>
              </motion.div>
            )}
          </div>
          
          <div className="flex items-center gap-2 mt-1">
            <div className="flex-1">
              <div className="h-2 bg-muted/50 rounded-full overflow-hidden">
                <motion.div
                  className={`h-full rounded-full ${isComplete ? "bg-success" : "bg-primary"}`}
                  initial={{ width: 0 }}
                  animate={{ width: `${Math.min(progress, 100)}%` }}
                  transition={{ duration: 1, ease: "easeOut" }}
                />
              </div>
            </div>
            <span className="text-sm font-medium tabular-nums">
              {reunioes}/{meta}
            </span>
          </div>

          {!isComplete && remaining > 0 && (
            <p className="text-xs text-muted-foreground mt-1">
              Faltam <span className="text-primary font-semibold">{remaining}</span> para o bônus
            </p>
          )}
        </div>

        {/* Progress ring */}
        <ProgressRing progress={progress} size={60} strokeWidth={6} />

        {/* Bonus indicator */}
        {isComplete && bonusValue > 0 && (
          <motion.div
            initial={{ opacity: 0, scale: 0 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.5, type: "spring" }}
            className="flex-shrink-0"
          >
            <div className="bg-success/20 border border-success/30 rounded-lg px-3 py-2 text-center">
              <p className="text-xs text-success">Bônus</p>
              <p className="text-lg font-bold text-success">
                R$ {bonusValue.toLocaleString("pt-BR")}
              </p>
            </div>
          </motion.div>
        )}
      </div>
    </motion.div>
  );
}

// Team goal thermometer
function TeamThermometer({ current, goal, daysRemaining }: { current: number; goal: number; daysRemaining: number }) {
  const progress = goal > 0 ? (current / goal) * 100 : 0;
  const isComplete = progress >= 100;
  const segments = 5;
  const segmentValue = goal / segments;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="relative p-6 rounded-2xl bg-gradient-to-br from-primary/10 via-background to-background border border-primary/20 overflow-hidden"
    >
      {/* Celebration overlay */}
      <AnimatePresence>
        {isComplete && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 pointer-events-none"
          >
            {[...Array(12)].map((_, i) => (
              <motion.div
                key={i}
                className="absolute"
                initial={{ 
                  x: "50%", 
                  y: "50%", 
                  scale: 0,
                  opacity: 1 
                }}
                animate={{ 
                  x: `${Math.random() * 100}%`,
                  y: `${Math.random() * 100}%`,
                  scale: [0, 1.5, 0],
                  opacity: [1, 1, 0]
                }}
                transition={{ 
                  duration: 2,
                  delay: i * 0.1,
                  repeat: Infinity,
                  repeatDelay: 3
                }}
              >
                <Star className="w-4 h-4 text-yellow-400" />
              </motion.div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className={`p-3 rounded-xl ${isComplete ? "bg-success/20" : "bg-primary/20"}`}>
            <Target className={`w-6 h-6 ${isComplete ? "text-success" : "text-primary"}`} />
          </div>
          <div>
            <h3 className="font-bold text-lg">Meta da Equipe</h3>
            <p className="text-sm text-muted-foreground">
              {daysRemaining > 0 ? `${daysRemaining} dias restantes` : "Prazo encerrado"}
            </p>
          </div>
        </div>
        
        {isComplete && (
          <motion.div
            initial={{ scale: 0, rotate: -10 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ type: "spring", stiffness: 200 }}
          >
            <Badge className="bg-success text-white text-lg px-4 py-2 gap-2">
              <Trophy className="w-5 h-5" />
              META BATIDA!
            </Badge>
          </motion.div>
        )}
      </div>

      {/* Thermometer */}
      <div className="relative h-16 bg-muted/30 rounded-full overflow-hidden mb-4">
        {/* Segments */}
        <div className="absolute inset-0 flex">
          {[...Array(segments)].map((_, i) => (
            <div 
              key={i} 
              className="flex-1 border-r border-background/20 last:border-r-0"
            />
          ))}
        </div>

        {/* Progress */}
        <motion.div
          className={`absolute inset-y-0 left-0 rounded-full ${
            isComplete 
              ? "bg-gradient-to-r from-success via-success to-emerald-400" 
              : "bg-gradient-to-r from-primary via-primary to-violet-400"
          }`}
          initial={{ width: 0 }}
          animate={{ width: `${Math.min(progress, 100)}%` }}
          transition={{ duration: 1.5, ease: "easeOut" }}
        >
          {/* Shine effect */}
          <motion.div
            className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent"
            animate={{ x: ["-100%", "200%"] }}
            transition={{ duration: 2, repeat: Infinity, repeatDelay: 1 }}
          />
        </motion.div>

        {/* Current value indicator */}
        <motion.div
          className="absolute top-1/2 -translate-y-1/2 flex items-center"
          initial={{ left: 0 }}
          animate={{ left: `${Math.min(progress, 95)}%` }}
          transition={{ duration: 1.5, ease: "easeOut" }}
        >
          <div className={`px-4 py-2 rounded-full font-bold text-white shadow-lg ${
            isComplete ? "bg-success" : "bg-primary"
          }`}>
            <AnimatedNumber value={current} />
          </div>
        </motion.div>
      </div>

      {/* Segment labels */}
      <div className="flex justify-between text-xs text-muted-foreground">
        {[...Array(segments + 1)].map((_, i) => (
          <span key={i} className="font-medium">
            {Math.round(i * segmentValue)}
          </span>
        ))}
      </div>
    </motion.div>
  );
}

export function CampanhaAnalytics({
  campanha,
  stages,
  leads,
  members,
}: CampanhaAnalyticsProps) {
  const deadline = new Date(campanha.deadline);
  const daysRemaining = differenceInDays(deadline, new Date());
  const isExpired = isPast(deadline);

  // Find the "reuniao_marcada" stage
  const reuniaoStage = stages.find((s) => s.is_reuniao_marcada);
  const meetingsCount = leads.filter((l) => l.stage_id === reuniaoStage?.id).length;
  const teamProgress = campanha.team_goal > 0 ? (meetingsCount / campanha.team_goal) * 100 : 0;

  // Count leads per stage for pie chart
  const stageData = stages.map((stage) => ({
    name: stage.name,
    value: leads.filter((l) => l.stage_id === stage.id).length,
    color: stage.color || "#3B82F6",
  }));

  // Count meetings per member for ranking
  const memberData = members
    .map((member) => {
      const memberMeetings = leads.filter(
        (l) => l.sdr_id === member.team_member_id && l.stage_id === reuniaoStage?.id
      ).length;

      return {
        member,
        reunioes: memberMeetings,
        meta: campanha.individual_goal || 0,
        atingiu: memberMeetings >= (campanha.individual_goal || 0),
      };
    })
    .sort((a, b) => b.reunioes - a.reunioes);

  // Calculate total bonus to be paid
  const bonusEarnedCount = memberData.filter((m) => m.atingiu).length;
  const totalBonusToPay = bonusEarnedCount * (campanha.bonus_value || 0);

  return (
    <div className="space-y-6">
      {/* Team Goal Thermometer */}
      <TeamThermometer 
        current={meetingsCount} 
        goal={campanha.team_goal} 
        daysRemaining={isExpired ? 0 : daysRemaining}
      />

      {/* Quick Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
        >
          <Card className="border-primary/20 bg-gradient-to-br from-primary/5 to-transparent">
            <CardContent className="pt-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-primary/10">
                  <Flame className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Progresso</p>
                  <p className="text-xl font-bold">
                    <AnimatedNumber value={Math.round(teamProgress)} suffix="%" />
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
        >
          <Card className="border-warning/20 bg-gradient-to-br from-warning/5 to-transparent">
            <CardContent className="pt-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-warning/10">
                  <Calendar className="w-5 h-5 text-warning" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Prazo</p>
                  <p className="text-xl font-bold">
                    {isExpired ? (
                      <span className="text-destructive">Encerrada</span>
                    ) : (
                      <AnimatedNumber value={daysRemaining} suffix=" dias" />
                    )}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
        >
          <Card className="border-chart-4/20 bg-gradient-to-br from-chart-4/5 to-transparent">
            <CardContent className="pt-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-chart-4/10">
                  <Trophy className="w-5 h-5 text-chart-4" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Bônus Atingidos</p>
                  <p className="text-xl font-bold">
                    <AnimatedNumber value={bonusEarnedCount} suffix={`/${members.length}`} />
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
        >
          <Card className="border-success/20 bg-gradient-to-br from-success/5 to-transparent">
            <CardContent className="pt-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-success/10">
                  <DollarSign className="w-5 h-5 text-success" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Total Bônus</p>
                  <p className="text-xl font-bold text-success">
                    <AnimatedNumber value={totalBonusToPay} prefix="R$ " />
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>

      {/* Individual Rankings - Gamified */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Crown className="w-5 h-5 text-yellow-400" />
            Ranking & Metas Individuais
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {memberData.length > 0 ? (
            memberData.map((data, index) => (
              <MemberGoalCard
                key={data.member.id}
                member={data.member}
                reunioes={data.reunioes}
                meta={data.meta}
                rank={index + 1}
                bonusValue={campanha.bonus_value || 0}
              />
            ))
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              Nenhum vendedor na campanha
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Performance Chart */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="w-4 h-4" />
              Performance Individual
            </CardTitle>
          </CardHeader>
          <CardContent>
            {memberData.length > 0 ? (
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={memberData.map(d => ({ 
                  name: d.member.team_member?.name || "?", 
                  reunioes: d.reunioes,
                  meta: d.meta
                }))} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" opacity={0.1} />
                  <XAxis type="number" />
                  <YAxis dataKey="name" type="category" width={100} fontSize={12} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "8px",
                    }}
                  />
                  <Bar
                    dataKey="reunioes"
                    fill="hsl(var(--primary))"
                    radius={[0, 4, 4, 0]}
                  />
                  <Bar
                    dataKey="meta"
                    fill="hsl(var(--muted))"
                    radius={[0, 4, 4, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                Nenhum vendedor na campanha
              </div>
            )}
          </CardContent>
        </Card>

        {/* Leads by Stage */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="w-4 h-4" />
              Distribuição por Etapa
            </CardTitle>
          </CardHeader>
          <CardContent>
            {stageData.some((s) => s.value > 0) ? (
              <ResponsiveContainer width="100%" height={250}>
                <PieChart>
                  <Pie
                    data={stageData.filter((s) => s.value > 0)}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={90}
                    paddingAngle={2}
                    dataKey="value"
                    label={({ name, value }) => `${name}: ${value}`}
                    labelLine={false}
                  >
                    {stageData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "8px",
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                Nenhum lead na campanha
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
